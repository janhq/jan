import os
import json
import mimetypes
import re
import logging
from reportportal_client.helpers import timestamp

logger = logging.getLogger(__name__)

def upload_turn_folder(client, test_item_id, turn_path, turn_name, force_fail=False):
    """
    Upload turn folder content to ReportPortal
    """
    step_item_id = client.start_test_item(
        parent_item_id=test_item_id,
        name=turn_name,
        start_time=timestamp(),
        item_type="STEP"
    )

    uploaded = False
    step_has_errors = False  # Track if this step has any errors
    
    for fname in sorted(os.listdir(turn_path)):
        fpath = os.path.join(turn_path, fname)

        if fname.endswith(".json"):
            try:
                with open(fpath, "r", encoding="utf-8") as f:
                    data = json.load(f)
                client.log(
                    time=timestamp(),
                    level="INFO",
                    message=f"[{fname}]\n{json.dumps(data, indent=2)}",
                    item_id=step_item_id
                )
                uploaded = True
            except Exception as e:
                client.log(
                    time=timestamp(),
                    level="ERROR",
                    message=f"[ERROR parsing {fname}] {str(e)}",
                    item_id=step_item_id
                )
                step_has_errors = True

        elif fname.endswith(".png"):
            try:
                with open(fpath, "rb") as img_file:
                    client.log(
                        time=timestamp(),
                        level="INFO",
                        message=f"Screenshot: {fname}",
                        item_id=step_item_id,
                        attachment={
                            "name": fname,
                            "data": img_file.read(),
                            "mime": mimetypes.guess_type(fname)[0] or "image/png"
                        }
                    )
                uploaded = True
            except Exception as e:
                client.log(
                    time=timestamp(),
                    level="ERROR",
                    message=f"[ERROR attaching {fname}] {str(e)}",
                    item_id=step_item_id
                )
                step_has_errors = True

    if not uploaded:
        client.log(
            time=timestamp(),
            level="WARNING",
            message="No data found in this turn.",
            item_id=step_item_id
        )

    # Determine step status based on test case result
    if force_fail:
        step_status = "FAILED"
    else:
        step_status = "FAILED" if step_has_errors else "PASSED"
    
    client.finish_test_item(
        item_id=step_item_id,
        end_time=timestamp(),
        status=step_status
    )

def extract_test_result_from_trajectory(trajectory_dir):
    """
    Extract test result from the last turn's API response
    Returns True only if found {"result": True}, False for all other cases including {"result": False}
    """
    if not trajectory_dir or not os.path.exists(trajectory_dir):
        logger.warning(f"Trajectory directory not found: {trajectory_dir}")
        return False
    
    try:
        # Get all turn folders and find the last one
        turn_folders = [f for f in os.listdir(trajectory_dir) 
                       if os.path.isdir(os.path.join(trajectory_dir, f)) and f.startswith("turn_")]
        
        if not turn_folders:
            logger.warning("No turn folders found")
            return False
        
        # Sort to get the last turn
        last_turn = sorted(turn_folders)[-1]
        last_turn_path = os.path.join(trajectory_dir, last_turn)
        
        logger.info(f"Checking result in last turn: {last_turn}")
        
        # Look for API call response files
        response_files = [f for f in os.listdir(last_turn_path) 
                         if f.startswith("api_call_") and f.endswith("_response.json")]
        
        if not response_files:
            logger.warning("No API response files found in last turn")
            return False
        
        # Check the last response file
        last_response_file = sorted(response_files)[-1]
        response_file_path = os.path.join(last_turn_path, last_response_file)
        
        logger.info(f"Checking response file: {last_response_file}")
        
        with open(response_file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        # Extract content from response
        if 'response' in data and 'choices' in data['response'] and data['response']['choices']:
            last_choice = data['response']['choices'][-1]
            if 'message' in last_choice and 'content' in last_choice['message']:
                content = last_choice['message']['content']
                logger.info(f"Last response content: {content}")
                
                # Look for result patterns - need to check both True and False
                true_pattern = r'\{\s*"result"\s*:\s*True\s*\}'
                false_pattern = r'\{\s*"result"\s*:\s*False\s*\}'
                
                true_match = re.search(true_pattern, content)
                false_match = re.search(false_pattern, content)
                
                if true_match:
                    logger.info(f"Found test result: True - PASSED")
                    return True
                elif false_match:
                    logger.info(f"Found test result: False - FAILED")
                    return False
                else:
                    logger.warning("No valid result pattern found in response content - marking as FAILED")
                    return False
        
        logger.warning("Could not extract content from response structure")
        return False
        
    except Exception as e:
        logger.error(f"Error extracting test result: {e}")
        return False

def upload_test_results_to_rp(client, launch_id, test_path, trajectory_dir, force_stopped=False, video_path=None):
    """
    Upload test results to ReportPortal with proper status based on test result
    """
    if not trajectory_dir or not os.path.exists(trajectory_dir):
        logger.warning(f"Trajectory directory not found: {trajectory_dir}")
        formatted_test_path = test_path.replace('\\', '/').replace('.txt', '').replace('/', '__')
        test_item_id = client.start_test_item(
            launch_id=launch_id,
            name=formatted_test_path,
            start_time=timestamp(),
            item_type="TEST",
            description=f"Test case from: {test_path}"
        )
        client.log(
            time=timestamp(),
            level="ERROR",
            message="❌ TEST FAILED ❌\nNo trajectory directory found",
            item_id=test_item_id
        )
        
        # Upload video if available
        if video_path and os.path.exists(video_path):
            try:
                with open(video_path, "rb") as video_file:
                    client.log(
                        time=timestamp(),
                        level="INFO",
                        message="Screen recording of test execution",
                        item_id=test_item_id,
                        attachment={
                            "name": f"test_recording_{formatted_test_path}.mp4",
                            "data": video_file.read(),
                            "mime": "video/x-msvideo"
                        }
                    )
                logger.info(f"Uploaded video for failed test: {video_path}")
            except Exception as e:
                logger.error(f"Error uploading video: {e}")
        
        client.finish_test_item(
            item_id=test_item_id,
            end_time=timestamp(),
            status="FAILED"
        )
        return
    
    formatted_test_path = test_path.replace('\\', '/').replace('.txt', '').replace('/', '__')
    
    # Determine final status
    if force_stopped:
        final_status = "FAILED"
        status_message = "exceeded maximum turn limit (30 turns)"
    else:
        test_result = extract_test_result_from_trajectory(trajectory_dir)
        if test_result is True:
            final_status = "PASSED" 
            status_message = "completed successfully with positive result"
        else:
            final_status = "FAILED"
            status_message = "no valid success result found"
    
    # Create test item
    test_item_id = client.start_test_item(
        launch_id=launch_id,
        name=formatted_test_path,
        start_time=timestamp(),
        item_type="TEST",
        description=f"Test case from: {test_path}"
    )
    
    try:
        turn_folders = [f for f in os.listdir(trajectory_dir) 
                       if os.path.isdir(os.path.join(trajectory_dir, f)) and f.startswith("turn_")]
        
        # Add clear status log
        status_emoji = "✅" if final_status == "PASSED" else "❌"
        client.log(
            time=timestamp(),
            level="INFO" if final_status == "PASSED" else "ERROR",
            message=f"{status_emoji} TEST {final_status} {status_emoji}\nReason: {status_message}\nTotal turns: {len(turn_folders)}",
            item_id=test_item_id
        )
        
        # Upload screen recording video first
        if video_path and os.path.exists(video_path):
            logger.info(f"Attempting to upload video: {video_path}")
            logger.info(f"Video file size: {os.path.getsize(video_path)} bytes")
            try:
                with open(video_path, "rb") as video_file:
                    video_data = video_file.read()
                    logger.info(f"Read video data: {len(video_data)} bytes")
                    client.log(
                        time=timestamp(),
                        level="INFO",
                        message="🎥 Screen recording of test execution",
                        item_id=test_item_id,
                        attachment={
                            "name": f"test_recording_{formatted_test_path}.mp4",
                            "data": video_data,
                            "mime": "video/x-msvideo"
                        }
                    )
                logger.info(f"Successfully uploaded screen recording: {video_path}")
            except Exception as e:
                logger.error(f"Error uploading screen recording: {e}")
                client.log(
                    time=timestamp(),
                    level="WARNING",
                    message=f"Failed to upload screen recording: {str(e)}",
                    item_id=test_item_id
                )
        else:
            logger.warning(f"Video upload skipped - video_path: {video_path}, exists: {os.path.exists(video_path) if video_path else 'N/A'}")
            client.log(
                time=timestamp(),
                level="WARNING",
                message="No screen recording available for this test",
                item_id=test_item_id
            )
        
        # Upload all turn data with appropriate status
        # If test failed, mark all turns as failed
        force_fail_turns = (final_status == "FAILED")
        
        for turn_folder in sorted(turn_folders):
            turn_path = os.path.join(trajectory_dir, turn_folder)
            upload_turn_folder(client, test_item_id, turn_path, turn_folder, force_fail=force_fail_turns)
        
        # Finish with correct status
        client.finish_test_item(
            item_id=test_item_id,
            end_time=timestamp(),
            status=final_status
        )
        
        logger.info(f"Uploaded test results for {formatted_test_path}: {final_status}")
        
    except Exception as e:
        logger.error(f"Error uploading test results: {e}")
        client.finish_test_item(
            item_id=test_item_id,
            end_time=timestamp(),
            status="FAILED"
        )