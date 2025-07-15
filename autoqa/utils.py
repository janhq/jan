import os
import logging
import subprocess
import psutil
import time
import pyautogui
import pygetwindow as gw
from pathlib import Path

logger = logging.getLogger(__name__)

def is_jan_running(jan_process_name="Jan.exe"):
    """
    Check if Jan application is currently running
    """
    for proc in psutil.process_iter(['pid', 'name']):
        try:
            if proc.info['name'] and jan_process_name.lower() in proc.info['name'].lower():
                return True
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            pass
    return False

def force_close_jan(jan_process_name="Jan.exe"):
    """
    Force close Jan application if it's running
    """
    logger.info("Checking for running Jan processes...")
    closed_any = False
    
    for proc in psutil.process_iter(['pid', 'name']):
        try:
            if proc.info['name'] and jan_process_name.lower() in proc.info['name'].lower():
                logger.info(f"Force closing Jan process (PID: {proc.info['pid']})")
                proc.kill()
                closed_any = True
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            pass
    
    if closed_any:
        logger.info("Waiting for Jan processes to terminate...")
        time.sleep(3)  # Wait for processes to fully terminate
    else:
        logger.info("No Jan processes found running")

def maximize_jan_window():
    """
    Find and maximize Jan window
    """
    try:
        # Wait a bit for window to appear
        time.sleep(2)
        
        # Method 1: Try to find window by title containing "Jan"
        windows = gw.getWindowsWithTitle("Jan")
        if windows:
            jan_window = windows[0]
            logger.info(f"Found Jan window: {jan_window.title}")
            jan_window.maximize()
            logger.info("Jan window maximized using pygetwindow")
            return True
        
        # Method 2: If not found, try Alt+Space then X (maximize hotkey)
        logger.info("Jan window not found by title, trying Alt+Space+X hotkey")
        pyautogui.hotkey('alt', 'space')
        time.sleep(0.5)
        pyautogui.press('x')
        logger.info("Attempted to maximize using Alt+Space+X")
        return True
        
    except Exception as e:
        logger.warning(f"Could not maximize Jan window: {e}")
        
        # Method 3: Try Windows+Up arrow (maximize current window)
        try:
            logger.info("Trying Windows+Up arrow to maximize")
            pyautogui.hotkey('win', 'up')
            return True
        except Exception as e2:
            logger.warning(f"All maximize methods failed: {e2}")
            return False

def start_jan_app(jan_app_path=r"C:\Users\tomin\AppData\Local\Programs\jan\Jan.exe"):
    """
    Start Jan application in maximized window
    """
    logger.info(f"Starting Jan application from: {jan_app_path}")
    
    if not os.path.exists(jan_app_path):
        logger.error(f"Jan executable not found at: {jan_app_path}")
        raise FileNotFoundError(f"Jan app not found at {jan_app_path}")
    
    try:
        # Start the Jan application
        subprocess.Popen([jan_app_path], shell=True)
        logger.info("Jan application started")
        
        # Wait for app to fully load
        logger.info("Waiting for Jan application to initialize...")
        time.sleep(5)
        
        # Try to maximize the window
        if maximize_jan_window():
            logger.info("Jan application maximized successfully")
        else:
            logger.warning("Could not maximize Jan application window")
        
        # Wait a bit more after maximizing
        time.sleep(2)
        logger.info("Jan application should be ready")
        time.sleep(20)  # Additional wait to ensure everything is ready
        
    except Exception as e:
        logger.error(f"Error starting Jan application: {e}")
        raise

def scan_test_files(tests_dir="tests"):
    """
    Scan tests folder and find all .txt files
    Returns list with format [{'path': 'relative_path', 'prompt': 'file_content'}]
    """
    test_files = []
    tests_path = Path(tests_dir)
    
    if not tests_path.exists():
        logger.error(f"Tests directory {tests_dir} does not exist!")
        return test_files
    
    # Scan all .txt files in folder and subfolders
    for txt_file in tests_path.rglob("*.txt"):
        try:
            # Read file content
            with open(txt_file, 'r', encoding='utf-8') as f:
                content = f.read().strip()
            
            # Get relative path
            relative_path = txt_file.relative_to(tests_path)
            
            test_files.append({
                'path': str(relative_path),
                'prompt': content
            })
            logger.info(f"Found test file: {relative_path}")
        except Exception as e:
            logger.error(f"Error reading file {txt_file}: {e}")
    
    return test_files

def get_latest_trajectory_folder(trajectory_base_path):
    """
    Get the latest created folder in trajectory base path
    """
    if not os.path.exists(trajectory_base_path):
        logger.warning(f"Trajectory base path not found: {trajectory_base_path}")
        return None
    
    # Get all folders and sort by creation time (latest first)
    folders = [f for f in os.listdir(trajectory_base_path) 
               if os.path.isdir(os.path.join(trajectory_base_path, f))]
    
    if not folders:
        logger.warning(f"No trajectory folders found in: {trajectory_base_path}")
        return None
    
    # Sort by folder name (assuming timestamp format like 20250715_100443)
    folders.sort(reverse=True)
    latest_folder = folders[0]
    
    full_path = os.path.join(trajectory_base_path, latest_folder)
    logger.info(f"Found latest trajectory folder: {full_path}")
    return full_path