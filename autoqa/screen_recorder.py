import cv2
import numpy as np
import pyautogui
import threading
import time
import logging

logger = logging.getLogger(__name__)

class ScreenRecorder:
    def __init__(self, output_path, fps=10):
        self.output_path = output_path
        self.fps = fps
        self.recording = False
        self.writer = None
        self.thread = None
        
    def start_recording(self):
        """Start screen recording"""
        if self.recording:
            logger.warning("Recording already in progress")
            return
            
        self.recording = True
        self.thread = threading.Thread(target=self._record_screen, daemon=True)
        self.thread.start()
        logger.info(f"Started screen recording: {self.output_path}")
        
    def stop_recording(self):
        """Stop screen recording"""
        if not self.recording:
            logger.warning("No recording in progress")
            return
            
        self.recording = False
        if self.thread:
            self.thread.join(timeout=5)
        if self.writer:
            self.writer.release()
        logger.info(f"Stopped screen recording: {self.output_path}")
        
    def _record_screen(self):
        """Internal method to record screen"""
        try:
            # Get screen dimensions
            screen_size = pyautogui.size()
            
            # Try MP4 with H264 codec for better compatibility
            fourcc = cv2.VideoWriter_fourcc(*'mp4v')  # or 'H264'
            output_path_mp4 = self.output_path
            
            self.writer = cv2.VideoWriter(
                output_path_mp4, 
                fourcc, 
                self.fps, 
                screen_size
            )
            
            while self.recording:
                try:
                    # Capture screen
                    screenshot = pyautogui.screenshot()
                    
                    # Convert PIL image to numpy array
                    frame = np.array(screenshot)
                    
                    # Convert RGB to BGR (OpenCV uses BGR)
                    frame = cv2.cvtColor(frame, cv2.COLOR_RGB2BGR)
                    
                    # Write frame
                    self.writer.write(frame)
                    
                    # Control FPS
                    time.sleep(1.0 / self.fps)
                    
                except Exception as e:
                    logger.error(f"Error capturing frame: {e}")
                    break
                    
        except Exception as e:
            logger.error(f"Error in screen recording: {e}")
        finally:
            if self.writer:
                self.writer.release()