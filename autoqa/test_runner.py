import os
import asyncio
import threading
import time
import logging
from datetime import datetime
from pathlib import Path
# from computer import Computer
from agent import ComputerAgent, LLM

from utils import is_jan_running, force_close_jan, start_jan_app, get_latest_trajectory_folder
from screen_recorder import ScreenRecorder
from reportportal_handler import upload_test_results_to_rp
from reportportal_client.helpers import timestamp

logger = logging.getLogger(__name__)

async def run_single_test_with_timeout(computer, test_data, rp_client, launch_id, max_turns=30, 
                                     jan_app_path=None, jan_process_name="Jan.exe", agent_config=None, 
                                     enable_reportportal=False):
    """
    Run a single test case with turn count monitoring, forced stop, and screen recording
    Returns dict with test result: {"success": bool, "status": str, "message": str}
    """
    path = test_data['path']
    prompt = test_data['prompt']
    
    # Detect if using nightly version based on process name
    is_nightly = "nightly" in jan_process_name.lower() if jan_process_name else False
    
    # Default agent config if not provided
    if agent_config is None:
        agent_config = {
            "loop": "uitars",
            "model_provider": "oaicompat",
            "model_name": "ByteDance-Seed/UI-TARS-1.5-7B",
            "model_base_url": "http://10.200.108.58:1234/v1"
        }
    
    # Create trajectory_dir from path (remove .txt extension)
    trajectory_name = str(Path(path).with_suffix(''))
    trajectory_base_dir = os.path.abspath(f"trajectories/{trajectory_name.replace(os.sep, '/')}")
    
    # Ensure trajectories directory exists
    os.makedirs(os.path.dirname(trajectory_base_dir), exist_ok=True)
    
    # Create recordings directory
    recordings_dir = "recordings"
    os.makedirs(recordings_dir, exist_ok=True)
    
    # Create video filename
    current_time = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe_test_name = trajectory_name.replace('/', '_').replace('\\', '_')
    video_filename = f"{safe_test_name}_{current_time}.mp4"
    video_path = os.path.abspath(os.path.join(recordings_dir, video_filename))
    
    # Initialize result tracking
    test_result_data = {
        "success": False,
        "status": "UNKNOWN",
        "message": "Test execution incomplete",
        "trajectory_dir": None,
        "video_path": video_path
    }
    
    logger.info(f"Starting test: {path}")
    logger.info(f"Current working directory: {os.getcwd()}")
    logger.info(f"Trajectory base directory: {trajectory_base_dir}")
    logger.info(f"Screen recording will be saved to: {video_path}")
    logger.info(f"Using model: {agent_config['model_name']} from {agent_config['model_base_url']}")
    logger.info(f"ReportPortal upload: {'ENABLED' if enable_reportportal else 'DISABLED'}")
    
    trajectory_dir = None
    agent_task = None
    monitor_stop_event = threading.Event()
    force_stopped_due_to_turns = False  # Track if test was force stopped
    
    # Initialize screen recorder
    recorder = ScreenRecorder(video_path, fps=10)
    
    try:
        # Step 1: Check and force close Jan app if running
        if is_jan_running(jan_process_name):
            logger.info("Jan application is running, force closing...")
            force_close_jan(jan_process_name)
        
        # Step 2: Start Jan app in maximized mode
        if jan_app_path:
            start_jan_app(jan_app_path)
        else:
            start_jan_app()  # Use default path
        
        # Step 3: Start screen recording
        recorder.start_recording()
        
        # Step 4: Create agent for this test using config
        agent = ComputerAgent(
            computer=computer,
            loop=agent_config["loop"],
            model=LLM(
                provider=agent_config["model_provider"],
                name=agent_config["model_name"],
                provider_base_url=agent_config["model_base_url"]
            ),
            trajectory_dir=trajectory_base_dir
        )
        
        # Step 5: Start monitoring thread
        def monitor_thread():
            nonlocal force_stopped_due_to_turns
            while not monitor_stop_event.is_set():
                try:
                    if os.path.exists(trajectory_base_dir):
                        folders = [f for f in os.listdir(trajectory_base_dir) 
                                  if os.path.isdir(os.path.join(trajectory_base_dir, f))]
                        
                        if folders:
                            latest_folder = sorted(folders)[-1]
                            latest_folder_path = os.path.join(trajectory_base_dir, latest_folder)
                            
                            if os.path.exists(latest_folder_path):
                                turn_folders = [f for f in os.listdir(latest_folder_path) 
                                               if os.path.isdir(os.path.join(latest_folder_path, f)) and f.startswith("turn_")]
                                
                                turn_count = len(turn_folders)
                                logger.info(f"Current turn count: {turn_count}")
                                
                                if turn_count >= max_turns:
                                    logger.warning(f"Turn count exceeded {max_turns} for test {path}, forcing stop")
                                    force_stopped_due_to_turns = True  # Mark as force stopped
                                    # Cancel the agent task
                                    if agent_task and not agent_task.done():
                                        agent_task.cancel()
                                    monitor_stop_event.set()
                                    return
                    
                    # Check every 5 seconds
                    if not monitor_stop_event.wait(5):
                        continue
                    else:
                        break
                        
                except Exception as e:
                    logger.error(f"Error in monitor thread: {e}")
                    time.sleep(5)
        
        # Start monitoring in background thread
        monitor_thread_obj = threading.Thread(target=monitor_thread, daemon=True)
        monitor_thread_obj.start()
        
        # Step 6: Run the test with prompt
        logger.info(f"Running test case: {path}")
        
        try:
            # Create the agent task
            async def run_agent():
                async for result in agent.run(prompt):
                    if monitor_stop_event.is_set():
                        logger.warning(f"Test {path} stopped due to turn limit")
                        break
                    logger.info(f"Test result for {path}: {result}")
                    print(result)
            
            agent_task = asyncio.create_task(run_agent())
            
            # Wait for agent task to complete or timeout
            try:
                await asyncio.wait_for(agent_task, timeout=600)  # 10 minute timeout as backup
                if not monitor_stop_event.is_set():
                    logger.info(f"Successfully completed test execution: {path}")
                else:
                    logger.warning(f"Test {path} was stopped due to turn limit")
                    
            except asyncio.TimeoutError:
                logger.warning(f"Test {path} timed out after 10 minutes")
                agent_task.cancel()
                
            except asyncio.CancelledError:
                logger.warning(f"Test {path} was cancelled due to turn limit")
                
        finally:
            # Stop monitoring
            monitor_stop_event.set()
            
    except Exception as e:
        logger.error(f"Error running test {path}: {e}")
        monitor_stop_event.set()
        # Update result data for exception case
        test_result_data.update({
            "success": False,
            "status": "ERROR",
            "message": f"Test execution failed with exception: {str(e)}",
            "trajectory_dir": None
        })
    
    finally:
        # Step 7: Stop screen recording
        try:
            recorder.stop_recording()
            logger.info(f"Screen recording saved to: {video_path}")
        except Exception as e:
            logger.error(f"Error stopping screen recording: {e}")
        
        # Step 8: Upload results to ReportPortal only if enabled
        if enable_reportportal and rp_client and launch_id:
            # Get trajectory folder first
            trajectory_dir = get_latest_trajectory_folder(trajectory_base_dir)
            
            try:
                if trajectory_dir:
                    logger.info(f"Uploading results to ReportPortal for: {path}")
                    logger.info(f"Video path for upload: {video_path}")
                    logger.info(f"Video exists: {os.path.exists(video_path)}")
                    if os.path.exists(video_path):
                        logger.info(f"Video file size: {os.path.getsize(video_path)} bytes")
                    upload_test_results_to_rp(rp_client, launch_id, path, trajectory_dir, force_stopped_due_to_turns, video_path, is_nightly)
                else:
                    logger.warning(f"Test completed but no trajectory found for: {path}")
                    # Handle case where test completed but no trajectory found
                    formatted_test_path = path.replace('\\', '/').replace('.txt', '').replace('/', '__')
                    test_item_id = rp_client.start_test_item(
                        launch_id=launch_id,
                        name=formatted_test_path,
                        start_time=timestamp(),
                        item_type="TEST"
                    )
                    rp_client.log(
                        time=timestamp(),
                        level="ERROR",
                        message="Test execution completed but no trajectory data found",
                        item_id=test_item_id
                    )
                    
                    # Still upload video for failed test
                    if video_path and os.path.exists(video_path):
                        try:
                            with open(video_path, "rb") as video_file:
                                rp_client.log(
                                    time=timestamp(),
                                    level="INFO",
                                    message="[INFO] Screen recording of failed test",
                                    item_id=test_item_id,
                                    attachment={
                                        "name": f"failed_test_recording_{formatted_test_path}.mp4",
                                        "data": video_file.read(),
                                        "mime": "video/x-msvideo"
                                    }
                                )
                        except Exception as e:
                            logger.error(f"Error uploading video for failed test: {e}")
                    
                    rp_client.finish_test_item(
                        item_id=test_item_id,
                        end_time=timestamp(),
                        status="FAILED"
                    )
            except Exception as upload_error:
                logger.error(f"Error uploading results for {path}: {upload_error}")
        else:
            # For non-ReportPortal mode, still get trajectory for final results
            trajectory_dir = get_latest_trajectory_folder(trajectory_base_dir)

        # Always process results for consistency (both RP and local mode)
        # trajectory_dir is already set above, no need to call get_latest_trajectory_folder again
        if trajectory_dir:
            # Extract test result for processing
            from reportportal_handler import extract_test_result_from_trajectory
            
            if force_stopped_due_to_turns:
                final_status = "FAILED"
                status_message = "exceeded maximum turn limit ({} turns)".format(max_turns)
                test_result_data.update({
                    "success": False,
                    "status": final_status,
                    "message": status_message,
                    "trajectory_dir": trajectory_dir
                })
            else:
                test_result = extract_test_result_from_trajectory(trajectory_dir)
                if test_result is True:
                    final_status = "PASSED" 
                    status_message = "completed successfully with positive result"
                    test_result_data.update({
                        "success": True,
                        "status": final_status,
                        "message": status_message,
                        "trajectory_dir": trajectory_dir
                    })
                else:
                    final_status = "FAILED"
                    status_message = "no valid success result found"
                    test_result_data.update({
                        "success": False,
                        "status": final_status,
                        "message": status_message,
                        "trajectory_dir": trajectory_dir
                    })
            
            if not enable_reportportal:
                # Local development mode - log results
                logger.info(f"[INFO] LOCAL RESULT: {path} - {final_status} ({status_message})")
                logger.info(f"[INFO] Video saved: {video_path}")
                logger.info(f"[INFO] Trajectory: {trajectory_dir}")
        else:
            final_status = "FAILED"
            status_message = "no trajectory found"
            test_result_data.update({
                "success": False,
                "status": final_status,
                "message": status_message,
                "trajectory_dir": None
            })
            
            if not enable_reportportal:
                logger.warning(f"[INFO] LOCAL RESULT: {path} - {final_status} ({status_message})")
        
        # Step 9: Always force close Jan app after test completion
        logger.info(f"Cleaning up after test: {path}")
        force_close_jan(jan_process_name)
        
        # Return test result
        return test_result_data