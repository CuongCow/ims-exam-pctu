const { app, BrowserWindow, globalShortcut, ipcMain, shell, Tray, Menu, screen, dialog } = require('electron');
const express = require('express');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execSync } = require('child_process');

// Helper function to get Windows system command path
function getWindowsCommand(command) {
  if (process.platform !== 'win32') {
    return command;
  }
  
  const systemRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
  const commandMap = {
    'tasklist': path.join(systemRoot, 'System32', 'tasklist.exe'),
    'wmic': path.join(systemRoot, 'System32', 'wbem', 'wmic.exe'),
    'powershell': path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    'reg': path.join(systemRoot, 'System32', 'reg.exe')
  };
  
  return commandMap[command.toLowerCase()] || command;
}

// Local HTTP server for health check
const httpServer = express();
let serverInstance = null;

// Enable CORS for health check endpoint
httpServer.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

httpServer.get('/health', (req, res) => {
  console.log('[HEALTH] Health check request received from:', req.ip || req.connection.remoteAddress);
  const response = { 
    success: true, 
    name: 'IMS EXAM PCTU',
    version: app.getVersion(),
    status: 'running',
    platform: process.platform,
    timestamp: new Date().toISOString()
  };
  console.log('[HEALTH] Sending response:', JSON.stringify(response));
  res.json(response);
});

// Endpoint to start exam (called by web app when student starts exam)
// This will activate system lock features (block Alt+Tab, Print Screen, etc.)
httpServer.post('/start-exam', express.json(), (req, res) => {
  console.log('[START-EXAM] Request received from:', req.ip || req.connection.remoteAddress);
  console.log('[START-EXAM] Request body:', req.body);
  console.log('[START-EXAM] Current lock status:', isLocked);
  
  // Start locking system features
  if (!isLocked) {
    console.log('[START-EXAM] Locking system features...');
    lockSystemFeatures();
    isLocked = true;
    console.log('[START-EXAM] ✅ System features locked');
  } else {
    console.log('[START-EXAM] System already locked, skipping...');
  }

  const response = {
    success: true,
    message: 'System lock activated',
    locked: true
  };
  console.log('[START-EXAM] Sending response:', JSON.stringify(response));
  res.json(response);
});

// Endpoint to stop exam (called when exam ends)
// This will unlock system features
httpServer.post('/stop-exam', express.json(), (req, res) => {
  console.log('[STOP-EXAM] Request received from:', req.ip || req.connection.remoteAddress);
  console.log('[STOP-EXAM] Current lock status:', isLocked);
  
  // Unlock system features
  if (isLocked) {
    console.log('[STOP-EXAM] Unlocking system features...');
    unlockSystemFeatures();
    isLocked = false;
    console.log('[STOP-EXAM] ✅ System features unlocked');
  } else {
    console.log('[STOP-EXAM] System already unlocked, skipping...');
  }

  const response = {
    success: true,
    message: 'System lock deactivated',
    locked: false
  };
  console.log('[STOP-EXAM] Sending response:', JSON.stringify(response));
  res.json(response);
});

// Endpoint to handle exam submission - keep fullscreen/kiosk and start countdown
httpServer.post('/exam-submitted', express.json(), (req, res) => {
  console.log('[EXAM-SUBMITTED] Request received from:', req.ip || req.connection.remoteAddress);
  
  try {
    if (examWindow && !examWindow.isDestroyed()) {
      console.log('[EXAM-SUBMITTED] Exam submitted - keeping fullscreen/kiosk mode and showing countdown...');
      
      // Mark exam as submitted (allows user to exit fullscreen/kiosk if they want)
      examSubmitted = true;
      
      // Keep fullscreen and kiosk mode - do NOT exit
      // User can still exit manually if needed, but we keep it for security
      console.log('[EXAM-SUBMITTED] ✅ Fullscreen/kiosk mode maintained');
      
      // Show countdown in exam window (small countdown in bottom-right corner)
      examWindow.webContents.executeJavaScript(`
        (function() {
          // Remove existing countdown if any
          const existingCountdown = document.getElementById('ims-exam-pctu-countdown');
          if (existingCountdown) {
            existingCountdown.remove();
          }
          
          // Create small countdown overlay in bottom-right corner
          const countdownDiv = document.createElement('div');
          countdownDiv.id = 'ims-exam-pctu-countdown';
          countdownDiv.style.cssText = 
            'position: fixed; bottom: 20px; right: 20px; ' +
            'background: rgba(0, 0, 0, 0.85); border: 2px solid #4CAF50; ' +
            'border-radius: 12px; padding: 15px 20px; z-index: 99999999; ' +
            'font-family: system-ui, -apple-system, sans-serif; ' +
            'box-shadow: 0 4px 12px rgba(0,0,0,0.3); min-width: 200px;';
          
          const title = document.createElement('div');
          title.textContent = '✅ Bài thi đã được nộp';
          title.style.cssText = 'font-size: 14px; margin-bottom: 8px; font-weight: 600; color: #4CAF50; text-align: center;';
          
          const message = document.createElement('div');
          message.textContent = 'Tự động đóng sau:';
          message.style.cssText = 'font-size: 12px; color: #ccc; text-align: center; margin-bottom: 8px;';

          const countdownText = document.createElement('div');
          countdownText.id = 'countdown-text';
          countdownText.style.cssText = 'font-size: 32px; font-weight: bold; text-align: center; color: #4CAF50; font-family: "Courier New", monospace; margin-bottom: 12px;';
          
          
          // Create "Đóng ngay" button
          const closeButton = document.createElement('button');
          closeButton.textContent = 'Đóng ngay';
          closeButton.style.cssText = 
            'width: 100%; padding: 10px 16px; ' +
            'background: linear-gradient(135deg, #FF6B6B 0%, #EE5A6F 100%); ' +
            'color: white; border: none; border-radius: 8px; ' +
            'font-size: 14px; font-weight: 600; ' +
            'cursor: pointer; transition: all 0.2s ease; ' +
            'box-shadow: 0 2px 8px rgba(255, 107, 107, 0.3); ' +
            'font-family: system-ui, -apple-system, sans-serif;';
          
          // Hover effect
          closeButton.onmouseenter = () => {
            closeButton.style.background = 'linear-gradient(135deg, #FF5252 0%, #E53935 100%)';
            closeButton.style.transform = 'translateY(-1px)';
            closeButton.style.boxShadow = '0 4px 12px rgba(255, 107, 107, 0.4)';
          };
          closeButton.onmouseleave = () => {
            closeButton.style.background = 'linear-gradient(135deg, #FF6B6B 0%, #EE5A6F 100%)';
            closeButton.style.transform = 'translateY(0)';
            closeButton.style.boxShadow = '0 2px 8px rgba(255, 107, 107, 0.3)';
          };
          
          // Click handler to close window immediately
          closeButton.onclick = () => {
            // Clear countdown interval
            if (countdownInterval) {
              clearInterval(countdownInterval);
              countdownInterval = null;
            }
            
            // Show closing message
            countdownText.textContent = 'Đang đóng...';
            countdownText.style.color = '#FF9800';
            closeButton.disabled = true;
            closeButton.style.opacity = '0.6';
            closeButton.style.cursor = 'not-allowed';
            
            // Close window immediately
            setTimeout(() => {
              // Send IPC message to close window
              if (window.imsExamPCTU && window.imsExamPCTU.closeWindow) {
                window.imsExamPCTU.closeWindow();
              } else if (window.electron && window.electron.ipcRenderer) {
                window.electron.ipcRenderer.send('close-exam-window');
              } else {
                // Fallback: try window.close()
                window.close();
              }
            }, 300);
          };
          
          countdownDiv.appendChild(title);
          countdownDiv.appendChild(message);
          countdownDiv.appendChild(countdownText);
          countdownDiv.appendChild(closeButton);
          document.body.appendChild(countdownDiv);
          
          // Start countdown (2 minutes = 120 seconds)
          let timeLeft = 120;
          let countdownInterval = null;
          
          const updateCountdown = () => {
            const minutes = Math.floor(timeLeft / 60);
            const secs = timeLeft % 60;
            countdownText.textContent = minutes + ':' + (secs < 10 ? '0' : '') + secs;
            
            if (timeLeft <= 0) {
              // Clear interval
              if (countdownInterval) {
                clearInterval(countdownInterval);
                countdownInterval = null;
              }
              
              // Show closing message
              countdownText.textContent = 'Đang đóng...';
              countdownText.style.color = '#FF9800';
              
              // Disable button
              closeButton.disabled = true;
              closeButton.style.opacity = '0.6';
              closeButton.style.cursor = 'not-allowed';
              
              // Close window after a short delay
              setTimeout(() => {
                // Send IPC message to close window
                if (window.imsExamPCTU && window.imsExamPCTU.closeWindow) {
                  window.imsExamPCTU.closeWindow();
                } else if (window.electron && window.electron.ipcRenderer) {
                  window.electron.ipcRenderer.send('close-exam-window');
                } else {
                  // Fallback: try window.close()
                  window.close();
                }
              }, 500);
            } else {
              timeLeft--;
            }
          };
          
          // Update immediately
          updateCountdown();
          
          // Then update every second
          countdownInterval = setInterval(updateCountdown, 1000);
        })();
      `).catch(err => console.error('[EXAM-SUBMITTED] Error showing countdown:', err));
      
      res.json({
        success: true,
        message: 'Fullscreen/kiosk maintained, countdown started'
      });
    } else {
      console.log('[EXAM-SUBMITTED] Exam window not found or already closed');
      res.json({
        success: true,
        message: 'Exam window not found'
      });
    }
  } catch (error) {
    console.error('[EXAM-SUBMITTED] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Error handling exam submission',
      error: error.message
    });
  }
});

// IPC handler to close exam window when countdown finishes
ipcMain.on('close-exam-window', () => {
  if (examWindow && !examWindow.isDestroyed()) {
    console.log('[EXAM-SUBMITTED] Closing exam window after countdown...');
    examWindow.close();
  }
});

// Endpoint to open exam in IMS EXAM PCTU app (instead of browser)
// This endpoint receives exam data and opens exam window
httpServer.post('/open-exam', express.json(), (req, res) => {
  console.log('[OPEN-EXAM] Request received from:', req.ip || req.connection.remoteAddress);
  console.log('[OPEN-EXAM] Request body:', req.body);
  
  try {
    const { examId, attemptId, token, serverUrl } = req.body;
    
    if (!examId || !attemptId || !token || !serverUrl) {
      return res.status(400).json({
        success: false,
        message: 'Thiếu thông tin cần thiết (examId, attemptId, token, serverUrl)'
      });
    }
    
    // Open exam window in IMS EXAM PCTU app
    // Don't await - let it run asynchronously
    createExamWindow(examId, attemptId, token, serverUrl).catch(err => {
      console.error('[OPEN-EXAM] Error creating exam window:', err);
    });
    
    res.json({
      success: true,
      message: 'Exam window opened in IMS EXAM PCTU'
    });
  } catch (error) {
    console.error('[OPEN-EXAM] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Lỗi khi mở exam window',
      error: error.message
    });
  }
});

// Endpoint to get keyboard blocking script for browser
// This script will be injected into the exam page to block browser shortcuts
httpServer.get('/keyboard-block-script', (req, res) => {
  console.log('[KEYBOARD-BLOCK] Script request received from:', req.ip || req.connection.remoteAddress);
  
  // JavaScript code to block browser keyboard shortcuts and detect/block Developer Tools
  const keyboardBlockScript = `
(function() {
  'use strict';
  
  // Developer Tools detection and blocking
  let devToolsCheckInterval = null;
  let isMonitoringDevTools = false;
  
  function detectDeveloperTools() {
    let devToolsOpen = false;
    
    // Method 1: Check window dimensions (most reliable)
    const threshold = 160;
    const widthThreshold = window.outerWidth - window.innerWidth > threshold;
    const heightThreshold = window.outerHeight - window.innerHeight > threshold;
    
    if (widthThreshold || heightThreshold) {
      devToolsOpen = true;
    }
    
    // Method 2: Console detection (Chrome/Edge)
    try {
      const element = new Image();
      let detected = false;
      Object.defineProperty(element, 'id', {
        get: function() {
          detected = true;
        }
      });
      console.log('%c', element);
      console.clear();
      if (detected) {
        devToolsOpen = true;
      }
    } catch (e) {
      // Ignore errors
    }
    
    return devToolsOpen;
  }
  
  function handleDevToolsDetected() {
    // Show warning and potentially block exam
    const warningDiv = document.createElement('div');
    warningDiv.id = 'ims-exam-pctu-devtools-warning';
    warningDiv.style.cssText = 
      'position: fixed; top: 0; left: 0; right: 0; background: #ff3b30; color: white; ' +
      'padding: 15px 20px; text-align: center; z-index: 9999999; font-family: system-ui, -apple-system, sans-serif; ' +
      'font-size: 16px; font-weight: 600; box-shadow: 0 4px 12px rgba(0,0,0,0.3);';
    warningDiv.innerHTML = '⚠️ Phát hiện Developer Tools đang mở. Vui lòng đóng Developer Tools (F12 hoặc Ctrl+Shift+I) để tiếp tục làm bài thi.';
    
    // Remove existing warning if any
    const existing = document.getElementById('ims-exam-pctu-devtools-warning');
    if (existing) {
      existing.remove();
    }
    
    document.body.appendChild(warningDiv);
    
    // Prevent interaction with exam (optional - can be enabled if needed)
    // document.body.style.pointerEvents = 'none';
    // document.body.style.opacity = '0.5';
  }
  
  function startDevToolsMonitoring() {
    if (isMonitoringDevTools) {
      return; // Already monitoring
    }
    
    isMonitoringDevTools = true;
    devToolsCheckInterval = setInterval(() => {
      if (detectDeveloperTools()) {
        handleDevToolsDetected();
      } else {
        // DevTools closed, remove warning
        const warningDiv = document.getElementById('ims-exam-pctu-devtools-warning');
        if (warningDiv) {
          warningDiv.remove();
        }
      }
    }, 1000); // Check every second
  }
  
  function stopDevToolsMonitoring() {
    if (devToolsCheckInterval) {
      clearInterval(devToolsCheckInterval);
      devToolsCheckInterval = null;
      isMonitoringDevTools = false;
    }
    const warningDiv = document.getElementById('ims-exam-pctu-devtools-warning');
    if (warningDiv) {
      warningDiv.remove();
    }
  }
  
  // Start monitoring immediately
  startDevToolsMonitoring();
  
  // Also check on window resize (DevTools often triggers resize)
  const resizeHandler = () => {
    if (detectDeveloperTools()) {
      handleDevToolsDetected();
    }
  };
  window.addEventListener('resize', resizeHandler);
  
  // List of blocked keyboard shortcuts
  const blockedShortcuts = [
    // Tab management
    { key: 'T', ctrl: true, shift: false, alt: false, meta: false, desc: 'Mở tab mới (Ctrl+T)' },
    { key: 'W', ctrl: true, shift: false, alt: false, meta: false, desc: 'Đóng tab (Ctrl+W)' },
    { key: 'F4', ctrl: true, shift: false, alt: false, meta: false, desc: 'Đóng tab (Ctrl+F4)' },
    { key: 'Tab', ctrl: true, shift: false, alt: false, meta: false, desc: 'Chuyển tab (Ctrl+Tab)' },
    { key: 'Tab', ctrl: true, shift: true, alt: false, meta: false, desc: 'Chuyển tab ngược (Ctrl+Shift+Tab)' },
    { key: 'T', ctrl: true, shift: true, alt: false, meta: false, desc: 'Mở lại tab đã đóng (Ctrl+Shift+T)' },
    { key: 'W', ctrl: true, shift: true, alt: false, meta: false, desc: 'Đóng tất cả tab (Ctrl+Shift+W)' },
    
    // Tab switching with numbers (Ctrl+1 to Ctrl+9)
    { key: '1', ctrl: true, shift: false, alt: false, meta: false, desc: 'Chuyển đến tab 1 (Ctrl+1)' },
    { key: '2', ctrl: true, shift: false, alt: false, meta: false, desc: 'Chuyển đến tab 2 (Ctrl+2)' },
    { key: '3', ctrl: true, shift: false, alt: false, meta: false, desc: 'Chuyển đến tab 3 (Ctrl+3)' },
    { key: '4', ctrl: true, shift: false, alt: false, meta: false, desc: 'Chuyển đến tab 4 (Ctrl+4)' },
    { key: '5', ctrl: true, shift: false, alt: false, meta: false, desc: 'Chuyển đến tab 5 (Ctrl+5)' },
    { key: '6', ctrl: true, shift: false, alt: false, meta: false, desc: 'Chuyển đến tab 6 (Ctrl+6)' },
    { key: '7', ctrl: true, shift: false, alt: false, meta: false, desc: 'Chuyển đến tab 7 (Ctrl+7)' },
    { key: '8', ctrl: true, shift: false, alt: false, meta: false, desc: 'Chuyển đến tab 8 (Ctrl+8)' },
    { key: '9', ctrl: true, shift: false, alt: false, meta: false, desc: 'Chuyển đến tab cuối (Ctrl+9)' },
    
    // Navigation
    { key: 'N', ctrl: true, shift: true, alt: false, meta: false, desc: 'Cửa sổ ẩn danh (Ctrl+Shift+N)' },
    { key: 'N', ctrl: true, shift: false, alt: false, meta: false, desc: 'Cửa sổ mới (Ctrl+N)' },
    { key: 'L', ctrl: true, shift: false, alt: false, meta: false, desc: 'Chọn thanh địa chỉ (Ctrl+L)' },
    { key: 'D', ctrl: false, shift: false, alt: true, meta: false, desc: 'Chọn thanh địa chỉ (Alt+D)' },
    { key: 'O', ctrl: true, shift: false, alt: false, meta: false, desc: 'Mở file (Ctrl+O)' },
    
    // Browser features
    { key: 'H', ctrl: true, shift: false, alt: false, meta: false, desc: 'Lịch sử (Ctrl+H)' },
    { key: 'H', ctrl: true, shift: true, alt: false, meta: false, desc: 'Lịch sử (Ctrl+Shift+H - Firefox)' },
    { key: 'J', ctrl: true, shift: false, alt: false, meta: false, desc: 'Tải xuống (Ctrl+J)' },
    { key: 'D', ctrl: true, shift: false, alt: false, meta: false, desc: 'Đánh dấu (Ctrl+D)' },
    { key: 'D', ctrl: true, shift: true, alt: false, meta: false, desc: 'Lưu tất cả tab vào dấu trang (Ctrl+Shift+D)' },
    { key: 'O', ctrl: true, shift: true, alt: false, meta: false, desc: 'Quản lý dấu trang (Ctrl+Shift+O)' },
    { key: 'B', ctrl: true, shift: false, alt: false, meta: false, desc: 'Mở/đóng thanh dấu trang (Ctrl+B)' },
    { key: 'B', ctrl: true, shift: true, alt: false, meta: false, desc: 'Hiện/ẩn thanh dấu trang (Ctrl+Shift+B)' },
    { key: 'M', ctrl: true, shift: true, alt: false, meta: false, desc: 'Chuyển đổi hồ sơ người dùng (Ctrl+Shift+M)' },
    { key: 'Esc', ctrl: true, shift: true, alt: false, meta: false, desc: 'Task Manager (Ctrl+Shift+Esc)' },
    { key: 'K', ctrl: true, shift: false, alt: false, meta: false, desc: 'Chọn thanh tìm kiếm (Ctrl+K)' },
    { key: 'E', ctrl: true, shift: false, alt: false, meta: false, desc: 'Chọn thanh tìm kiếm (Ctrl+E)' },
    { key: 'Y', ctrl: true, shift: false, alt: false, meta: false, desc: 'Redo (Ctrl+Y)' },
    { key: 'Z', ctrl: true, shift: true, alt: false, meta: false, desc: 'Redo (Ctrl+Shift+Z)' },
    
    // Search & Find
    { key: 'F', ctrl: true, shift: false, alt: false, meta: false, desc: 'Tìm kiếm (Ctrl+F)' },
    { key: 'F', ctrl: true, shift: true, alt: false, meta: false, desc: 'Tìm kiếm trong trang (Ctrl+Shift+F)' },
    { key: 'G', ctrl: true, shift: false, alt: false, meta: false, desc: 'Tìm tiếp (Ctrl+G)' },
    { key: 'G', ctrl: true, shift: true, alt: false, meta: false, desc: 'Tìm trước (Ctrl+Shift+G)' },
    { key: 'L', ctrl: true, shift: true, alt: false, meta: false, desc: 'Tìm kiếm với công cụ tìm kiếm (Ctrl+Shift+L)' },
    
    // Page actions
    { key: 'R', ctrl: true, shift: false, alt: false, meta: false, desc: 'Tải lại (Ctrl+R)' },
    { key: 'R', ctrl: true, shift: true, alt: false, meta: false, desc: 'Tải lại bỏ cache (Ctrl+Shift+R)' },
    { key: 'U', ctrl: true, shift: false, alt: false, meta: false, desc: 'Mã nguồn (Ctrl+U)' },
    { key: 'Delete', ctrl: true, shift: true, alt: false, meta: false, desc: 'Xóa dữ liệu duyệt web (Ctrl+Shift+Del)' },
    
    // Developer tools
    { key: 'I', ctrl: true, shift: true, alt: false, meta: false, desc: 'Developer tools (Ctrl+Shift+I)' },
    { key: 'J', ctrl: true, shift: true, alt: false, meta: false, desc: 'Console (Ctrl+Shift+J)' },
    { key: 'C', ctrl: true, shift: true, alt: false, meta: false, desc: 'Element selector (Ctrl+Shift+C)' },
    { key: 'K', ctrl: true, shift: true, alt: false, meta: false, desc: 'Console (Ctrl+Shift+K - Firefox)' },
    { key: 'U', ctrl: true, shift: true, alt: false, meta: false, desc: 'Inspect element (Ctrl+Shift+U)' },
    
    // Browser-specific shortcuts (Firefox)
    { key: 'P', ctrl: true, shift: true, alt: false, meta: false, desc: 'Cửa sổ riêng tư (Ctrl+Shift+P - Firefox)' },
    { key: 'Q', ctrl: true, shift: true, alt: false, meta: false, desc: 'Thoát trình duyệt (Ctrl+Shift+Q - Firefox)' },
    
    // Browser-specific shortcuts (Edge)
    { key: 'S', ctrl: true, shift: true, alt: false, meta: false, desc: 'Menu chia sẻ (Ctrl+Shift+S - Edge)' },
    { key: 'U', ctrl: true, shift: true, alt: false, meta: false, desc: 'Trình đọc giọng nói (Ctrl+Shift+U - Edge)' },
    { key: 'Y', ctrl: true, shift: true, alt: false, meta: false, desc: 'Bộ sưu tập (Ctrl+Shift+Y - Edge)' },
    { key: 'E', ctrl: true, shift: true, alt: false, meta: false, desc: 'Trình quản lý extension (Ctrl+Shift+E - Edge)' },
    
    // Function keys
    { key: 'F3', ctrl: false, shift: false, alt: false, meta: false, desc: 'Tìm kiếm (F3)' },
    { key: 'F3', ctrl: false, shift: true, alt: false, meta: false, desc: 'Tìm trước (Shift+F3)' },
    { key: 'F5', ctrl: false, shift: false, alt: false, meta: false, desc: 'Tải lại (F5)' },
    { key: 'F6', ctrl: false, shift: false, alt: false, meta: false, desc: 'Chọn thanh địa chỉ (F6)' },
    { key: 'F11', ctrl: false, shift: false, alt: false, meta: false, desc: 'Toàn màn hình (F11)' },
    { key: 'F12', ctrl: false, shift: false, alt: false, meta: false, desc: 'Developer tools (F12)' },
    { key: 'Escape', ctrl: false, shift: false, alt: false, meta: false, desc: 'Dừng tải trang (Esc)' },
    { key: 'Esc', ctrl: false, shift: true, alt: false, meta: false, desc: 'Trình quản lý tác vụ trình duyệt (Shift+Esc - Chrome)' },
    
    // Alt key combinations
    { key: 'Left', ctrl: false, shift: false, alt: true, meta: false, desc: 'Quay lại (Alt+←)' },
    { key: 'Right', ctrl: false, shift: false, alt: true, meta: false, desc: 'Tiến tới (Alt+→)' },
    { key: 'Home', ctrl: false, shift: false, alt: true, meta: false, desc: 'Trang chủ (Alt+Home)' },
    { key: 'F', ctrl: false, shift: false, alt: true, meta: false, desc: 'Mở menu trình duyệt (Alt+F)' },
    { key: 'E', ctrl: false, shift: false, alt: true, meta: false, desc: 'Mở menu trình duyệt (Alt+E)' },
    
    // Print & Save
    { key: 'P', ctrl: true, shift: false, alt: false, meta: false, desc: 'In (Ctrl+P)' },
    { key: 'S', ctrl: true, shift: false, alt: false, meta: false, desc: 'Lưu (Ctrl+S)' },
    
    // Zoom (optional - can be enabled if needed)
    // { key: 'Equal', ctrl: true, shift: false, alt: false, meta: false, desc: 'Phóng to (Ctrl+=)' },
    // { key: 'Minus', ctrl: true, shift: false, alt: false, meta: false, desc: 'Thu nhỏ (Ctrl+-)' },
    // { key: '0', ctrl: true, shift: false, alt: false, meta: false, desc: 'Reset zoom (Ctrl+0)' },
    
    // Right-click context menu (optional)
    // Note: We don't block right-click as it might be needed for some exam interactions
  ];
  
  // Check if a key combination matches a blocked shortcut
  function isBlockedShortcut(e) {
    const key = e.key || e.code || '';
    const ctrl = e.ctrlKey || e.metaKey; // metaKey for Mac
    const shift = e.shiftKey;
    const alt = e.altKey;
    const meta = e.metaKey;
    
    // Normalize function keys and special keys
    let normalizedKey = key;
    if (key.startsWith('F') && /^F\d+$/.test(key)) {
      normalizedKey = key; // F1, F2, etc.
    } else if (key === '=' || key === '+') {
      normalizedKey = 'Equal';
    } else if (key === '-') {
      normalizedKey = 'Minus';
    } else if (key === 'Esc' || key === 'Escape') {
      normalizedKey = 'Escape';
    } else if (key === 'Delete' || key === 'Del') {
      normalizedKey = 'Delete';
    } else if (key === 'F4' && ctrl && !shift && !alt) {
      // Ctrl+F4 (close tab) - handled by F4 key
      normalizedKey = 'F4';
    }
    
    // Check against blocked shortcuts
    for (const shortcut of blockedShortcuts) {
      const keyMatch = normalizedKey === shortcut.key || 
                       key.toLowerCase() === shortcut.key.toLowerCase() ||
                       (shortcut.key === 'Tab' && (key === 'Tab' || key === '9'));
      
      if (keyMatch &&
          ctrl === shortcut.ctrl &&
          shift === shortcut.shift &&
          alt === shortcut.alt &&
          meta === shortcut.meta) {
        return { blocked: true, desc: shortcut.desc };
      }
    }
    
    return { blocked: false };
  }
  
  // Block keyboard shortcuts
  function blockShortcut(e) {
    // Allow typing in input fields, textareas, and contenteditable elements
    const target = e.target || e.srcElement;
    const isInputField = target.tagName === 'INPUT' || 
                        target.tagName === 'TEXTAREA' ||
                        target.isContentEditable ||
                        (target.tagName === 'DIV' && target.getAttribute('contenteditable') === 'true');
    
    // Don't block if user is typing in an input field (except for dangerous shortcuts)
    if (isInputField) {
      // Still block developer tools and function keys even in input fields
      const dangerousKeys = ['F3', 'F5', 'F6', 'F11', 'F12', 'Escape'];
      const key = e.key || e.code || '';
      if (!dangerousKeys.some(k => key === k || key === k.toLowerCase())) {
        // Allow normal shortcuts in input fields (Ctrl+C, Ctrl+V, etc.)
        if (e.ctrlKey || e.metaKey) {
          // Only block specific dangerous shortcuts in input fields
          const dangerousInInput = [
            { key: 'T', ctrl: true }, // New tab
            { key: 'W', ctrl: true }, // Close tab
            { key: 'F4', ctrl: true }, // Close tab (Ctrl+F4)
            { key: 'N', ctrl: true, shift: true }, // Incognito
            { key: 'H', ctrl: true }, // History
            { key: 'J', ctrl: true }, // Downloads
            { key: 'I', ctrl: true, shift: true }, // Dev tools
            { key: 'J', ctrl: true, shift: true }, // Console
            { key: 'C', ctrl: true, shift: true }, // Element selector
            { key: 'K', ctrl: true, shift: true }, // Console (Firefox)
            { key: 'L', ctrl: true }, // Address bar
            { key: 'O', ctrl: true }, // Open file
            { key: 'F3', ctrl: false }, // Search (F3)
            { key: 'F6', ctrl: false }, // Address bar (F6)
            { key: 'M', ctrl: true, shift: true }, // Switch profile (Ctrl+Shift+M)
            { key: 'Esc', ctrl: true, shift: true }, // Task Manager (Ctrl+Shift+Esc)
          ];
          
          const isDangerous = dangerousInInput.some(d => {
            const keyMatch = (key === d.key || key.toLowerCase() === d.key.toLowerCase());
            return keyMatch && 
                   (e.ctrlKey || e.metaKey) === d.ctrl &&
                   e.shiftKey === (d.shift || false);
          });
          
          if (!isDangerous) {
            return; // Allow other shortcuts in input fields
          }
        } else {
          return; // Allow non-ctrl shortcuts in input fields
        }
      }
    }
    
    const result = isBlockedShortcut(e);
    if (result.blocked) {
      console.warn('[IMS EXAM PCTU] Blocked shortcut:', result.desc);
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      
      // Show a brief notification (optional)
      showBlockedNotification(result.desc);
      
      return false;
    }
  }
  
  // Show a brief notification when shortcut is blocked
  function showBlockedNotification(desc) {
    // Remove existing notification if any
    const existing = document.getElementById('ims-exam-pctu-blocked-notification');
    if (existing) {
      existing.remove();
    }
    
    // Create notification element
    const notification = document.createElement('div');
    notification.id = 'ims-exam-pctu-blocked-notification';
    notification.style.cssText = 
      'position: fixed; top: 20px; right: 20px; background: #ff3b30; color: white; ' +
      'padding: 12px 20px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); ' +
      'z-index: 999999; font-family: system-ui, -apple-system, sans-serif; font-size: 14px; ' +
      'font-weight: 500; max-width: 300px; animation: slideIn 0.3s ease-out;';
    
    notification.textContent = '⛔ Phím tắt đã bị khóa: ' + desc;
    
    // Add animation
    const style = document.createElement('style');
    style.textContent = \`
      @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
      @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
      }
    \`;
    document.head.appendChild(style);
    
    document.body.appendChild(notification);
    
    // Remove after 2 seconds
    setTimeout(() => {
      notification.style.animation = 'slideOut 0.3s ease-out';
      setTimeout(() => {
        if (notification.parentNode) {
          notification.parentNode.removeChild(notification);
        }
      }, 300);
    }, 2000);
  }
  
  // Add event listeners
  // Use capture phase to catch events before they reach other handlers
  document.addEventListener('keydown', blockShortcut, true);
  document.addEventListener('keyup', blockShortcut, true);
  
  // Also block on window level
  window.addEventListener('keydown', blockShortcut, true);
  window.addEventListener('keyup', blockShortcut, true);
  
  // Prevent context menu (optional - uncomment if needed)
  // document.addEventListener('contextmenu', (e) => {
  //   e.preventDefault();
  //   return false;
  // }, true);
  
  console.log('[IMS EXAM PCTU] Keyboard blocking script loaded and active');
  
  // Return cleanup function (in case needed)
  return function cleanup() {
    stopDevToolsMonitoring();
    document.removeEventListener('keydown', blockShortcut, true);
    document.removeEventListener('keyup', blockShortcut, true);
    window.removeEventListener('keydown', blockShortcut, true);
    window.removeEventListener('keyup', blockShortcut, true);
    // Note: resizeHandler is captured in closure, cleanup handled by stopDevToolsMonitoring
    const warningDiv = document.getElementById('ims-exam-pctu-devtools-warning');
    if (warningDiv) {
      warningDiv.remove();
    }
    console.log('[IMS EXAM PCTU] Keyboard blocking script removed');
  };
})();
`;
  
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.send(keyboardBlockScript);
});

// Safety check endpoint - check for unsafe conditions
httpServer.get('/safety-check', (req, res) => {
  console.log('[SAFETY-CHECK] Safety check request received from:', req.ip || req.connection.remoteAddress);
  
  const safetyChecks = performSafetyChecks();
  
  console.log('[SAFETY-CHECK] Safety check results:', JSON.stringify(safetyChecks, null, 2));
  
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json(safetyChecks);
});

// Safety status endpoint - get last safety check result (cached, faster)
httpServer.get('/safety-status', (req, res) => {
  console.log('[SAFETY-STATUS] Safety status request received from:', req.ip || req.connection.remoteAddress);
  
  // If no cached result, run a fresh check
  if (!lastSafetyCheckResult) {
    console.log('[SAFETY-STATUS] No cached result, running fresh safety check...');
    performSafetyChecks();
  }
  
  const response = lastSafetyCheckResult || {
    safe: true,
    issues: [],
    warnings: [],
    timestamp: new Date().toISOString()
  };
  
  console.log('[SAFETY-STATUS] Returning safety status:', {
    safe: response.safe,
    issuesCount: response.issues?.length || 0,
    timestamp: response.timestamp
  });
  
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json(response);
});

// Start HTTP server on port 8765
function startHealthServer() {
  if (!serverInstance) {
    serverInstance = httpServer.listen(8765, 'localhost', () => {
      console.log('IMS EXAM PCTU health server running on http://localhost:8765');
    });
  }
}

// Stop HTTP server
function stopHealthServer() {
  if (serverInstance) {
    serverInstance.close();
    serverInstance = null;
  }
}

let welcomeWindow = null;
let examWindow = null;
let examSubmitted = false; // Track if exam has been submitted (to prevent re-enabling fullscreen/kiosk)
let tray = null;
let isLocked = false;
let processMonitor = null; // Process monitoring interval
let lastProcessSnapshot = null; // Last process list snapshot for comparison
let lastSafetyCheckResult = null; // Last safety check result
let processMonitorInterval = 5000; // Check every 5 seconds (optimized for performance)

// Detect if running in virtual machine
// Windows Registry keys for disabling Windows key
const WINDOWS_KEY_REGISTRY_PATH = 'HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Keyboard Layout';
const WINDOWS_KEY_SCANCODE_MAP = 'Scancode Map';

// Store original registry value to restore later
let originalWindowsKeyRegistryValue = null;
let windowsKeyDisabled = false;

// Disable Windows key via Registry (Windows only)
// WARNING: This requires administrator privileges and affects the entire system
function disableWindowsKey() {
  if (process.platform !== 'win32') {
    return; // Only works on Windows
  }
  
  if (windowsKeyDisabled) {
    console.log('[WINDOWS-KEY] Windows key already disabled');
    return;
  }
  
  try {
    // First, try to read current value to save it
    try {
      const currentValue = execSync(
        `"${getWindowsCommand('reg')}" query "${WINDOWS_KEY_REGISTRY_PATH}" /v "${WINDOWS_KEY_SCANCODE_MAP}"`,
        { encoding: 'utf-8', timeout: 3000, stdio: 'pipe' }
      );
      // Extract the value if it exists
      const match = currentValue.match(/Scancode Map\s+REG_BINARY\s+(.+)/);
      if (match) {
        originalWindowsKeyRegistryValue = match[1].trim();
        console.log('[WINDOWS-KEY] Saved original registry value:', originalWindowsKeyRegistryValue);
      }
    } catch (e) {
      // Registry key doesn't exist yet, that's fine
      console.log('[WINDOWS-KEY] No existing registry value to save');
    }
    
    // Disable Windows key by setting Scancode Map
    // This maps Windows key (LWin=0x5B, RWin=0x5C) to NULL (0x00)
    // Format: 00 00 00 00 00 00 00 00 03 00 00 00 00 00 5B E0 00 00 5C E0 00 00 00 00
    const scancodeMapValue = '00 00 00 00 00 00 00 00 03 00 00 00 00 00 5B E0 00 00 5C E0 00 00 00 00';
    
    // Set the registry value
    execSync(
      `"${getWindowsCommand('reg')}" add "${WINDOWS_KEY_REGISTRY_PATH}" /v "${WINDOWS_KEY_SCANCODE_MAP}" /t REG_BINARY /d "${scancodeMapValue}" /f`,
      { encoding: 'utf-8', timeout: 3000, stdio: 'pipe' }
    );
    
    windowsKeyDisabled = true;
    console.log('[WINDOWS-KEY] ✅ Windows key disabled via Registry');
    console.log('[WINDOWS-KEY] ⚠️ Note: Changes may require log out/in or restart to take full effect');
    
    // Try to restart explorer.exe to apply changes immediately (optional, may require admin)
    try {
      execSync('taskkill /F /IM explorer.exe && start explorer.exe', { 
        encoding: 'utf-8', 
        timeout: 5000,
        stdio: 'pipe',
        shell: true
      });
      console.log('[WINDOWS-KEY] ✅ Restarted explorer.exe to apply changes immediately');
    } catch (e) {
      console.warn('[WINDOWS-KEY] ⚠️ Could not restart explorer.exe (may require admin):', e.message);
      console.warn('[WINDOWS-KEY] User may need to log out/in or restart for changes to take effect');
    }
  } catch (error) {
    console.error('[WINDOWS-KEY] ❌ Error disabling Windows key via Registry:', error.message);
    console.error('[WINDOWS-KEY] This may require administrator privileges');
    console.error('[WINDOWS-KEY] Falling back to kiosk mode and before-input-event blocking');
  }
}

// Enable Windows key via Registry (restore original value)
function enableWindowsKey() {
  if (process.platform !== 'win32') {
    return; // Only works on Windows
  }
  
  if (!windowsKeyDisabled) {
    console.log('[WINDOWS-KEY] Windows key was not disabled, skipping restore');
    return;
  }
  
  try {
    if (originalWindowsKeyRegistryValue !== null) {
      // Restore original value
      execSync(
        `"${getWindowsCommand('reg')}" add "${WINDOWS_KEY_REGISTRY_PATH}" /v "${WINDOWS_KEY_SCANCODE_MAP}" /t REG_BINARY /d "${originalWindowsKeyRegistryValue}" /f`,
        { encoding: 'utf-8', timeout: 3000, stdio: 'pipe' }
      );
      console.log('[WINDOWS-KEY] ✅ Restored original Windows key registry value');
    } else {
      // Delete the registry key if we created it
      try {
        execSync(
          `"${getWindowsCommand('reg')}" delete "${WINDOWS_KEY_REGISTRY_PATH}" /v "${WINDOWS_KEY_SCANCODE_MAP}" /f`,
          { encoding: 'utf-8', timeout: 3000, stdio: 'pipe' }
        );
        console.log('[WINDOWS-KEY] ✅ Removed Windows key registry entry');
      } catch (e) {
        // Key doesn't exist, that's fine
        console.log('[WINDOWS-KEY] Registry key already removed or doesn\'t exist');
      }
    }
    
    windowsKeyDisabled = false;
    
    // Try to restart explorer.exe to apply changes immediately
    try {
      execSync('taskkill /F /IM explorer.exe && start explorer.exe', { 
        encoding: 'utf-8', 
        timeout: 5000,
        stdio: 'pipe',
        shell: true
      });
      console.log('[WINDOWS-KEY] ✅ Restarted explorer.exe to apply changes');
    } catch (e) {
      console.warn('[WINDOWS-KEY] ⚠️ Could not restart explorer.exe (may require admin):', e.message);
      console.warn('[WINDOWS-KEY] User may need to log out/in or restart for changes to take effect');
    }
  } catch (error) {
    console.error('[WINDOWS-KEY] ❌ Error enabling Windows key via Registry:', error.message);
  }
}

function detectVirtualMachine() {
  const { execSync } = require('child_process');
  
  // More accurate VM detection using multiple methods
  try {
    if (process.platform === 'win32') {
      // Method 1: Check BIOS/SMBIOS information via WMI
      try {
        const biosInfo = execSync(`"${getWindowsCommand('wmic')}" bios get manufacturer,version /format:list`, { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' });
        const biosLower = biosInfo.toLowerCase();
        
        const vmBiosIndicators = [
          'vmware',
          'virtualbox',
          'virtual box',
          'innotek', // VirtualBox manufacturer
          'qemu',
          'xen',
          'microsoft corporation', // Hyper-V (but be careful - also real hardware)
          'parallels'
        ];
        
        for (const indicator of vmBiosIndicators) {
          // Check for exact match in Manufacturer or Version fields
          if (biosLower.includes(`manufacturer=${indicator}`) || biosLower.includes(`version=${indicator}`)) {
            console.log(`[SAFETY-CHECK] VM detected via BIOS: ${indicator}`);
            return true;
          }
        }
      } catch (e) {
        console.warn('[SAFETY-CHECK] Error checking BIOS:', e.message);
      }
      
      // Method 2: Check system manufacturer via WMI (more reliable)
      try {
        const systemInfo = execSync(`"${getWindowsCommand('wmic')}" computersystem get manufacturer,model /format:list`, { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' });
        const systemLower = systemInfo.toLowerCase();
        
        // Common VM system identifiers
        const vmSystemManufacturers = [
          'vmware, inc.',
          'vmware, inc',
          'vmware',
          'innotek gmbh', // VirtualBox
          'microsoft corporation', // Hyper-V (but also real hardware, so check model too)
        ];
        
        const vmSystemModels = [
          'vmware',
          'virtualbox',
          'virtual box',
          'qemu',
          'xen',
          'parallels'
        ];
        
        // Check manufacturer
        for (const manufacturer of vmSystemManufacturers) {
          if (systemLower.includes(`manufacturer=${manufacturer}`)) {
            // For Microsoft, also check if model suggests VM
            if (manufacturer.includes('microsoft')) {
              for (const model of vmSystemModels) {
                if (systemLower.includes(`model=${model}`)) {
                  console.log(`[SAFETY-CHECK] VM detected via System Info: ${manufacturer} - ${model}`);
                  return true;
                }
              }
            } else {
              console.log(`[SAFETY-CHECK] VM detected via System Manufacturer: ${manufacturer}`);
              return true;
            }
          }
        }
        
        // Check model
        for (const model of vmSystemModels) {
          if (systemLower.includes(`model=${model}`)) {
            console.log(`[SAFETY-CHECK] VM detected via System Model: ${model}`);
            return true;
          }
        }
      } catch (e) {
        console.warn('[SAFETY-CHECK] Error checking system info:', e.message);
      }
      
      // Method 3: Check for VM processes (most reliable - only if VM tools are running)
      try {
        const processesOutput = execSync(`"${getWindowsCommand('tasklist')}" /FO CSV /NH`, { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' });
        const lines = processesOutput.split('\n').filter(line => line.trim());
        
        const processNames = lines.map(line => {
          const match = line.match(/"([^"]+\.exe)"/i);
          return match ? match[1].toLowerCase() : null;
        }).filter(name => name);
        
        // VM service processes that are definitive indicators
        const vmServiceProcesses = [
          'vmwaretray.exe',
          'vmwareuser.exe',
          'vmtoolsd.exe',
          'vboxservice.exe',
          'vboxtray.exe',
          'qemu-ga.exe',
          'xenservice.exe'
        ];
        
        for (const vmProc of vmServiceProcesses) {
          if (processNames.includes(vmProc)) {
            console.log(`[SAFETY-CHECK] VM detected via running service: ${vmProc}`);
            return true;
          }
        }
      } catch (e) {
        console.warn('[SAFETY-CHECK] Error checking VM processes:', e.message);
      }
    }
    
    // Method 4: Hostname check (less reliable, only as additional confirmation)
    // Only flag if hostname is explicitly a VM indicator, not if it contains common words
    const hostname = os.hostname().toLowerCase();
    const explicitVmHostnames = [
      'vmware',
      'vbox',
      'virtualbox',
      'qemu',
      'xen',
      'parallels'
    ];
    
    // Only match if hostname starts with or ends with VM indicator, or is exactly the indicator
    for (const vmName of explicitVmHostnames) {
      if (hostname === vmName || hostname.startsWith(`${vmName}-`) || hostname.endsWith(`-${vmName}`) || 
          hostname.startsWith(`${vmName}_`) || hostname.endsWith(`_${vmName}`)) {
        console.log(`[SAFETY-CHECK] VM detected via hostname: ${hostname} matches ${vmName}`);
        return true;
      }
    }
    
  } catch (error) {
    console.warn('[SAFETY-CHECK] Error in VM detection:', error.message);
  }
  
  return false;
}

// Perform comprehensive safety checks
function performSafetyChecks() {
  const { execSync } = require('child_process');
  
  const issues = [];
  const warnings = [];
  let isSafe = true;

  // 1. Check for virtual machine
  console.log('[SAFETY-CHECK] Checking for virtual machine...');
  if (detectVirtualMachine()) {
    issues.push({
      type: 'virtual_machine',
      severity: 'error',
      title: 'Phát hiện môi trường ảo (Virtual Machine)',
      description: 'Hệ thống phát hiện bạn đang chạy trong môi trường ảo (VMware, VirtualBox, etc.). Vui lòng tắt phần mềm ảo hóa và khởi động lại máy tính.',
      action: 'Tắt phần mềm ảo hóa và khởi động lại máy tính'
    });
    isSafe = false;
  }

  // 2. Check for remote desktop / remote control software
  console.log('[SAFETY-CHECK] Checking for remote desktop software...');
  // Use lowercase for comparison, but keep original names for display
  // Each app can have multiple process names/patterns
  const remoteDesktopApps = [
    { name: 'TeamViewer', processes: ['teamviewer', 'tv_w32', 'tv_x64', 'teamviewer_service', 'teamviewer_desktop', 'teamviewer_15', 'teamviewer_14'] },
    { name: 'AnyDesk', processes: ['anydesk', 'anydeskad', 'ad.tray', 'ad.service', 'anydesk.exe'] },
    { name: 'Chrome Remote Desktop', processes: ['remoting', 'remoting_host', 'remoting_desktop', 'chromoting'] },
    { name: 'Microsoft Remote Desktop', processes: ['msrdc', 'msrdcw', 'mstsc', 'mstsc.exe'] },
    { name: 'Windows Remote Desktop', processes: ['mstsc', 'rdpclip', 'rdpshell', 'termsrv'] },
    { name: 'VNC', processes: ['vnc', 'winvnc', 'vncconfig', 'vncviewer', 'vncmirror'] },
    { name: 'UltraVNC', processes: ['uvnc', 'winvnc', 'ultravnc', 'vncserver'] },
    { name: 'UltraViewer', processes: ['ultraviewer_service', 'ultraviewer_desktop'] },
    { name: 'TightVNC', processes: ['tvnserver', 'tvnviewer', 'tightvnc', 'tvncontrol'] },
    { name: 'LogMeIn', processes: ['logmein', 'lmiguardian', 'lmi', 'logmeinrescue'] },
    { name: 'Ammyy Admin', processes: ['ammyy', 'ammyyadmin', 'aa_v3'] },
    { name: 'Radmin', processes: ['radmin', 'radmin_server', 'radmin_viewer', 'rserv32', 'rserv64'] },
    { name: 'Splashtop', processes: ['splashtop', 'splashtopremote', 'splashtopstreamer', 'splashtoprns'] },
    { name: 'RemotePC', processes: ['remotepc', 'remotepcviewer', 'remotepcservice'] },
    { name: 'DWService', processes: ['DWAgent', 'DWService', 'dwservice'] },
    { name: 'Parsec', processes: ['parsec', 'parsecd'] },
    { name: 'RustDesk', processes: ['rustdesk'] },
    { name: 'Chrome Remote Desktop Host', processes: ['remoting_host', 'chromoting'] },
    { name: 'ScreenConnect', processes: ['screenconnect', 'screenconnect.client'] },
    { name: 'Remote Utilities', processes: ['rutview', 'rutserv', 'rutserver'] },
    { name: 'GoToMyPC', processes: ['gotomypc', 'g2mvwdm'] }
  ];

    try {
      let remoteDesktopDetected = false;
      let detectedApps = [];
      const detectedProcessNames = new Set(); // To avoid duplicates

      if (process.platform === 'win32') {
        // Windows: Check running processes - parse CSV to get exact process names
        try {
          const processesOutput = execSync(`"${getWindowsCommand('tasklist')}" /FO CSV /NH`, { encoding: 'utf-8', timeout: 5000 });
          const lines = processesOutput.split('\n').filter(line => line.trim());
          
          // Parse CSV: "Image Name","PID","Session Name","Session#","Mem Usage"
          const processNames = lines.map(line => {
            // CSV format: "process.exe","1234","Session","1","1234 K"
            const match = line.match(/"([^"]+\.exe)"/i);
            return match ? match[1].toLowerCase() : null;
          }).filter(name => name);
          
          console.log('[SAFETY-CHECK] Found processes:', processNames.length, 'total');
          
          // Debug: log all process names (first 50)
          if (processNames.length > 0) {
            console.log('[SAFETY-CHECK] Sample processes:', processNames.slice(0, 50).join(', '));
          }
          
          for (const app of remoteDesktopApps) {
            // Handle both single string and array of process names
            const processPatterns = Array.isArray(app.processes) ? app.processes : [app.processes];
            
            let found = false;
            let matchedProcess = null;
            let matchedPattern = null;
            
            for (const pattern of processPatterns) {
              const patternLower = pattern.toLowerCase();
              
              // Check if any process matches this pattern
              const match = processNames.find(p => {
                // Normalize: remove .exe extension for comparison
                const pNormalized = p.replace(/\.exe$/, '').toLowerCase();
                const patternNormalized = patternLower.replace(/\.exe$/, '').toLowerCase();
                
                // Match exact name or if process name starts with pattern (for cases like "teamviewer_service.exe")
                const isExactMatch = pNormalized === patternNormalized;
                const isPrefixMatch = pNormalized.startsWith(patternNormalized + '_') ||
                                      pNormalized.startsWith(patternNormalized + '.');
                
                if (isExactMatch || isPrefixMatch) {
                  // Only log in debug mode to reduce overhead
                  if (process.env.DEBUG) {
                    console.log(`[SAFETY-CHECK] Pattern match: "${patternNormalized}" matched process "${pNormalized}"`);
                  }
                  return true;
                }
                return false;
              });
              
              if (match) {
                found = true;
                matchedProcess = match;
                matchedPattern = patternLower;
                console.log(`[SAFETY-CHECK] ✓ Found remote desktop app: ${app.name} (matched process: ${match}, pattern: ${patternLower})`);
                break;
              }
            }
            
              if (found && !detectedApps.includes(app.name)) {
                remoteDesktopDetected = true;
                detectedApps.push(app.name);
                // Store the matched process for debugging
                if (matchedProcess) {
                  detectedProcessNames.add(matchedProcess);
                }
                // Log only when detected (important event)
                console.log(`[SAFETY-CHECK] Found remote desktop app: ${app.name} (process: ${matchedProcess})`);
              }
            }
        } catch (e) {
          console.warn('[SAFETY-CHECK] Error checking processes:', e.message);
        }

      // Check Windows Registry for remote desktop
      try {
        const regQuery = execSync(`"${getWindowsCommand('reg')}" query "HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server" /v fDenyTSConnections`, { encoding: 'utf-8', timeout: 5000 });
        if (regQuery.includes('0x0')) {
          // Remote Desktop is enabled
          remoteDesktopDetected = true;
          detectedApps.push('Windows Remote Desktop');
        }
      } catch (e) {
        // Registry key might not exist or access denied
      }
    }

    if (remoteDesktopDetected) {
      // Remove duplicates (case-insensitive)
      const uniqueApps = [...new Set(detectedApps.map(app => app.toLowerCase()))]
        .map(lower => {
          // Find original case from detectedApps
          const original = detectedApps.find(app => app.toLowerCase() === lower);
          return original || lower;
        });
      
      // Build description with app-specific instructions
      let description = `Hệ thống phát hiện các phần mềm điều khiển từ xa đang chạy: ${uniqueApps.join(', ')}. `;
      let action = `Tắt các phần mềm: ${uniqueApps.join(', ')}`;
      
      // Add specific instructions for UltraViewer (service runs in background)
      if (uniqueApps.some(app => app.toLowerCase().includes('ultraviewer'))) {
        description += 'Lưu ý: UltraViewer có service chạy nền ngay cả khi đã đóng ứng dụng. Để tắt hoàn toàn: (1) Mở Task Manager (Ctrl+Shift+Esc), (2) Vào tab Services, tìm và dừng "UltraViewer Service", (3) Vào tab Processes/Details, tắt tất cả process có tên UltraViewer (bao gồm UltraViewer_Service.exe). ';
        action = 'Tắt UltraViewer: Dừng service trong tab Services và tắt tất cả processes trong Task Manager';
      }
      
      description += 'Vui lòng tắt tất cả các phần mềm này trước khi vào thi.';
      
      issues.push({
        type: 'remote_desktop',
        severity: 'error',
        title: 'Phát hiện phần mềm điều khiển từ xa',
        description: description,
        action: action
      });
      isSafe = false;
    }
  } catch (error) {
    console.warn('[SAFETY-CHECK] Error checking remote desktop:', error.message);
  }

  // 3. Check for voice/chat software
  console.log('[SAFETY-CHECK] Checking for voice/chat software...');
  const voiceApps = [
    { name: 'Discord', process: 'discord' },
    { name: 'TeamSpeak', process: 'teamspeak' },
    { name: 'Zoom', process: 'zoom' },
    { name: 'Skype', process: 'skype' },
    { name: 'Microsoft Teams', process: 'ms-teams' },
    { name: 'Google Meet', process: 'meet' },
    { name: 'WhatsApp', process: 'whatsapp' },
    { name: 'Telegram', process: 'telegram' },
    { name: 'Zalo', process: 'zalo' },
    { name: 'Facebook Messenger', process: 'messenger' },
    { name: 'LINE', process: 'line' },
    { name: 'Viber', process: 'viber' },
    { name: 'Mumble', process: 'mumble' },
    { name: 'Ventrilo', process: 'ventrilo' }
  ];

    try {
      let voiceAppDetected = false;
      let detectedVoiceApps = [];
      const detectedVoiceProcessNames = new Set(); // To avoid duplicates

      if (process.platform === 'win32') {
        try {
          const processesOutput = execSync(`"${getWindowsCommand('tasklist')}" /FO CSV /NH`, { encoding: 'utf-8', timeout: 5000 });
          const lines = processesOutput.split('\n').filter(line => line.trim());
          
          // Parse CSV: "Image Name","PID","Session Name","Session#","Mem Usage"
          const processNames = lines.map(line => {
            const match = line.match(/"([^"]+\.exe)"/i);
            return match ? match[1].toLowerCase() : null;
          }).filter(name => name);
          
          for (const app of voiceApps) {
            // Check exact process name match (case-insensitive)
            const processNameLower = app.process.toLowerCase();
            const exactMatch = processNames.some(p => {
              const pWithoutExt = p.replace(/\.exe$/, '');
              const processWithoutExt = processNameLower.replace(/\.exe$/, '');
              return p === processNameLower || p === `${processNameLower}.exe` || 
                     pWithoutExt === processWithoutExt;
            });
            
            if (exactMatch && !detectedVoiceProcessNames.has(processNameLower)) {
              console.log(`[SAFETY-CHECK] Found voice app: ${app.name} (${processNameLower})`);
              voiceAppDetected = true;
              detectedVoiceApps.push(app.name);
              detectedVoiceProcessNames.add(processNameLower);
            }
          }
        } catch (e) {
          console.warn('[SAFETY-CHECK] Error checking voice apps:', e.message);
        }
      }

    if (voiceAppDetected) {
      // Remove duplicates (case-insensitive)
      const uniqueVoiceApps = [...new Set(detectedVoiceApps.map(app => app.toLowerCase()))]
        .map(lower => {
          // Find original case from detectedVoiceApps
          const original = detectedVoiceApps.find(app => app.toLowerCase() === lower);
          return original || lower;
        });
      
      issues.push({
        type: 'voice_software',
        severity: 'error',
        title: 'Phát hiện phần mềm chat/voice',
        description: `Hệ thống phát hiện các phần mềm chat/voice đang chạy: ${uniqueVoiceApps.join(', ')}. Vui lòng tắt tất cả các phần mềm này trước khi vào thi.`,
        action: `Tắt các phần mềm: ${uniqueVoiceApps.join(', ')}`
      });
      isSafe = false;
    }
  } catch (error) {
    console.warn('[SAFETY-CHECK] Error checking voice apps:', error.message);
  }

  // 4. Check for multiple displays
  console.log('[SAFETY-CHECK] Checking for multiple displays...');
  try {
    if (process.platform === 'win32') {
      try {
        // Method 1: Use System.Windows.Forms.Screen to get active displays (most reliable)
        const displayCountCmd = `"${getWindowsCommand('powershell')}" -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::AllScreens.Count"`;
        const displayCount = execSync(displayCountCmd, { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' });
        const count = parseInt(displayCount.trim());
        
        console.log('[SAFETY-CHECK] Active display count:', count);
        
        if (!isNaN(count) && count > 1) {
          issues.push({
            type: 'multiple_displays',
            severity: 'error',
            title: 'Phát hiện nhiều màn hình',
            description: `Hệ thống phát hiện ${count} màn hình đang được kết nối và hoạt động. Chỉ được phép sử dụng 1 màn hình khi thi.`,
            action: 'Tắt các màn hình phụ, chỉ giữ lại 1 màn hình'
          });
          isSafe = false;
        } else if (isNaN(count)) {
          // Fallback: Try WMI method (filter for active displays only)
          try {
            const wmiCmd = 'powershell -Command "$displays = Get-CimInstance -Namespace root\\wmi -ClassName WmiMonitorBasicDisplayParams; ($displays | Where-Object { $_.Active -eq $true }).Count"';
            const wmiCount = execSync(wmiCmd, { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' });
            const count2 = parseInt(wmiCount.trim());
            console.log('[SAFETY-CHECK] Active display count (WMI):', count2);
            
            if (!isNaN(count2) && count2 > 1) {
              issues.push({
                type: 'multiple_displays',
                severity: 'error',
                title: 'Phát hiện nhiều màn hình',
                description: `Hệ thống phát hiện ${count2} màn hình đang được kết nối và hoạt động. Chỉ được phép sử dụng 1 màn hình khi thi.`,
                action: 'Tắt các màn hình phụ, chỉ giữ lại 1 màn hình'
              });
              isSafe = false;
            }
          } catch (e2) {
            console.warn('[SAFETY-CHECK] Error checking displays (WMI fallback):', e2.message);
          }
        }
      } catch (e) {
        console.warn('[SAFETY-CHECK] Error checking displays:', e.message);
      }
    }
  } catch (error) {
    console.warn('[SAFETY-CHECK] Error checking displays:', error.message);
  }

  // 5. Check for screen sharing/recording software
  console.log('[SAFETY-CHECK] Checking for screen sharing/recording software...');
  const screenShareApps = [
    { name: 'OBS Studio', process: 'obs' },
    { name: 'XSplit', process: 'xsplit' },
    { name: 'Streamlabs', process: 'streamlabs' },
    { name: 'Nvidia ShadowPlay', process: 'shadowplay' },
    { name: 'AMD ReLive', process: 'relive' },
    { name: 'Bandicam', process: 'bandicam' },
    { name: 'Fraps', process: 'fraps' },
    { name: 'Camtasia', process: 'camtasia' },
    { name: 'ShareX', process: 'sharex' },
    { name: 'Lightshot', process: 'lightshot' },
    { name: 'Snipping Tool', process: 'snippingtool' }
  ];

    try {
      let screenShareDetected = false;
      let detectedScreenApps = [];
      const detectedScreenProcessNames = new Set(); // To avoid duplicates

      if (process.platform === 'win32') {
        try {
          const processesOutput = execSync(`"${getWindowsCommand('tasklist')}" /FO CSV /NH`, { encoding: 'utf-8', timeout: 5000 });
          const lines = processesOutput.split('\n').filter(line => line.trim());
          
          // Parse CSV: "Image Name","PID","Session Name","Session#","Mem Usage"
          const processNames = lines.map(line => {
            const match = line.match(/"([^"]+\.exe)"/i);
            return match ? match[1].toLowerCase() : null;
          }).filter(name => name);
          
          for (const app of screenShareApps) {
            // Check exact process name match (case-insensitive)
            const processNameLower = app.process.toLowerCase();
            const exactMatch = processNames.some(p => {
              const pWithoutExt = p.replace(/\.exe$/, '');
              const processWithoutExt = processNameLower.replace(/\.exe$/, '');
              return p === processNameLower || p === `${processNameLower}.exe` || 
                     pWithoutExt === processWithoutExt;
            });
            
            if (exactMatch && !detectedScreenProcessNames.has(processNameLower)) {
              console.log(`[SAFETY-CHECK] Found screen share app: ${app.name} (${processNameLower})`);
              screenShareDetected = true;
              detectedScreenApps.push(app.name);
              detectedScreenProcessNames.add(processNameLower);
            }
          }
        } catch (e) {
          console.warn('[SAFETY-CHECK] Error checking screen share apps:', e.message);
        }
      }

    if (screenShareDetected) {
      // Remove duplicates (case-insensitive)
      const uniqueScreenApps = [...new Set(detectedScreenApps.map(app => app.toLowerCase()))]
        .map(lower => {
          // Find original case from detectedScreenApps
          const original = detectedScreenApps.find(app => app.toLowerCase() === lower);
          return original || lower;
        });
      
      issues.push({
        type: 'screen_sharing',
        severity: 'error',
        title: 'Phát hiện phần mềm quay màn hình/chia sẻ màn hình',
        description: `Hệ thống phát hiện các phần mềm quay màn hình/chia sẻ màn hình đang chạy: ${uniqueScreenApps.join(', ')}. Vui lòng tắt tất cả các phần mềm này trước khi vào thi.`,
        action: `Tắt các phần mềm: ${uniqueScreenApps.join(', ')}`
      });
      isSafe = false;
    }
  } catch (error) {
    console.warn('[SAFETY-CHECK] Error checking screen share apps:', error.message);
  }

  const result = {
    safe: isSafe,
    issues: issues,
    warnings: warnings,
    timestamp: new Date().toISOString()
  };
  
  // Store last safety check result
  lastSafetyCheckResult = result;
  
  return result;
}

// Get current process list snapshot (optimized - only get process names, no sorting)
function getProcessSnapshot() {
  const { execSync } = require('child_process');
  
  try {
    if (process.platform === 'win32') {
      // Use /NH (no header) and /FI to reduce output size
      const processesOutput = execSync(`"${getWindowsCommand('tasklist')}" /FO CSV /NH`, { 
        encoding: 'utf-8', 
        timeout: 2000, // Reduced timeout for faster response
        stdio: 'pipe',
        maxBuffer: 1024 * 1024 // 1MB buffer
      });
      
      // Fast parsing - only extract process names
      const processNames = new Set();
      const lines = processesOutput.split('\n');
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        // Fast regex match for process name in CSV format
        const match = line.match(/"([^"]+\.exe)"/i);
        if (match) {
          processNames.add(match[1].toLowerCase());
        }
      }
      
      return processNames;
    }
  } catch (e) {
    console.warn('[PROCESS-MONITOR] Error getting process snapshot:', e.message);
  }
  
  return null;
}

// Compare two process snapshots (optimized - early exit on first difference)
function hasProcessChanged(oldSnapshot, newSnapshot) {
  if (!oldSnapshot || !newSnapshot) {
    return true; // If either is null, consider it changed
  }
  
  // Fast check: size difference
  if (oldSnapshot.size !== newSnapshot.size) {
    return true; // Different number of processes
  }
  
  // If sizes are equal, check if sets are identical (early exit optimization)
  // Check removals first (usually fewer)
  for (const process of oldSnapshot) {
    if (!newSnapshot.has(process)) {
      return true; // Process was removed
    }
  }
  
  // If no removals and sizes match, sets are identical (no need to check additions)
  return false;
}

// Start process monitoring
function startProcessMonitoring() {
  if (processMonitor) {
    console.log('[PROCESS-MONITOR] Process monitor already running');
    return;
  }
  
  console.log('[PROCESS-MONITOR] Starting process monitoring...');
  
  // Get initial snapshot
  lastProcessSnapshot = getProcessSnapshot();
  
  // Run initial safety check
  console.log('[PROCESS-MONITOR] Running initial safety check...');
  performSafetyChecks();
  
  // Start monitoring interval
  processMonitor = setInterval(() => {
    try {
      const currentSnapshot = getProcessSnapshot();
      
      if (hasProcessChanged(lastProcessSnapshot, currentSnapshot)) {
        // Only log if there's a significant change (more than just count difference)
        const sizeDiff = Math.abs((currentSnapshot?.size || 0) - (lastProcessSnapshot?.size || 0));
        if (sizeDiff > 0) {
          console.log('[PROCESS-MONITOR] Process list changed', {
            previous: lastProcessSnapshot?.size || 0,
            current: currentSnapshot?.size || 0,
            diff: sizeDiff
          });
        }
        
        // Run safety check (only when process actually changed)
        const oldSafe = lastSafetyCheckResult?.safe;
        performSafetyChecks();
        const newSafe = lastSafetyCheckResult?.safe;
        
        // Log if safety status changed (important event)
        if (oldSafe !== newSafe) {
          console.log(`[PROCESS-MONITOR] ⚠️ Safety status changed: ${oldSafe} -> ${newSafe}`);
        }
        
        lastProcessSnapshot = currentSnapshot;
      }
    } catch (error) {
      console.warn('[PROCESS-MONITOR] Error in monitoring loop:', error.message);
    }
  }, processMonitorInterval);
  
  console.log(`[PROCESS-MONITOR] Process monitor started (checking every ${processMonitorInterval}ms)`);
}

// Stop process monitoring
function stopProcessMonitoring() {
  if (processMonitor) {
    clearInterval(processMonitor);
    processMonitor = null;
    lastProcessSnapshot = null;
    console.log('[PROCESS-MONITOR] Process monitor stopped');
  }
}

// Create welcome window (modal with connection info)
// Function to create exam window in IMS EXAM PCTU app
async function createExamWindow(examId, attemptId, token, serverUrl) {
  console.log('[EXAM-WINDOW] Creating exam window:', { examId, attemptId, serverUrl });
  
  // Reset exam submitted flag for new exam
  examSubmitted = false;
  
  // Close existing exam window if any
  if (examWindow && !examWindow.isDestroyed()) {
    console.log('[EXAM-WINDOW] Closing existing exam window');
    // Remove all event listeners to prevent errors
    examWindow.removeAllListeners();
    examWindow.close();
    examWindow = null;
    // Wait a bit for window to fully close
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  // Get screen dimensions
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
  
  // Create fullscreen exam window with kiosk mode to block Windows key
  // Kiosk mode prevents Windows key from opening Start Menu
  examWindow = new BrowserWindow({
    width: screenWidth,
    height: screenHeight,
    x: 0,
    y: 0,
    fullscreen: true,
    kiosk: true, // Enable kiosk mode to block Windows key and Start Menu
    frame: true,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      preload: path.join(__dirname, 'preload.js') // Add preload script for IPC
    },
    show: false,
    title: 'IMS EXAM PCTU - Đang làm bài thi'
  });
  
  // Load exam page from server with token and exam info
  // Use query params to pass data to exam page
  const examUrl = `${serverUrl}/student/exams?examId=${examId}&attemptId=${attemptId}&token=${encodeURIComponent(token)}&inApp=true&fromApp=true`;
  console.log('[EXAM-WINDOW] Loading exam URL:', examUrl.replace(token, 'TOKEN_HIDDEN'));
  
  // Store token in sessionStorage for exam page to access
  examWindow.webContents.once('did-finish-load', () => {
    // Check if window still exists before accessing webContents
    if (!examWindow || examWindow.isDestroyed()) {
      console.warn('[EXAM-WINDOW] Window was destroyed before did-finish-load');
      return;
    }
    
    examWindow.webContents.executeJavaScript(`
      (function() {
        const urlParams = new URLSearchParams(window.location.search);
        const token = urlParams.get('token');
        if (token) {
          localStorage.setItem('token', token);
          console.log('[EXAM-WINDOW] Token stored in localStorage');
        }
      })();
    `).catch(err => console.error('[EXAM-WINDOW] Error storing token:', err));
  });
  
  examWindow.loadURL(examUrl);
  
  examWindow.once('ready-to-show', () => {
    // Check if window still exists before showing
    if (!examWindow || examWindow.isDestroyed()) {
      console.warn('[EXAM-WINDOW] Window was destroyed before ready-to-show');
      return;
    }
    
    // Ensure fullscreen mode
    if (!examWindow.isFullScreen()) {
      examWindow.setFullScreen(true);
      console.log('[EXAM-WINDOW] Set to fullscreen mode');
    }
    
    // Ensure kiosk mode is enabled (blocks Windows key)
    if (!examWindow.isKiosk()) {
      examWindow.setKiosk(true);
      console.log('[EXAM-WINDOW] Set to kiosk mode (blocks Windows key)');
    }
    
    examWindow.show();
    examWindow.focus();
    // Force window to front and activate
    examWindow.moveTop();
    examWindow.setAlwaysOnTop(true);
    // Set always on top only temporarily, then disable it
    setTimeout(() => {
      if (examWindow && !examWindow.isDestroyed()) {
        examWindow.setAlwaysOnTop(false);
      }
    }, 1000);
    console.log('[EXAM-WINDOW] Exam window shown and focused');
  });
  
  // Also focus when window becomes visible
  examWindow.on('show', () => {
    if (!examWindow || examWindow.isDestroyed()) {
      return;
    }
    // Ensure fullscreen and kiosk mode when window is shown (keep it even after submission)
    if (!examWindow.isFullScreen()) {
      examWindow.setFullScreen(true);
      console.log('[EXAM-WINDOW] Re-enabled fullscreen on show');
    }
    
    // Ensure kiosk mode is enabled (blocks Windows key) - keep it even after submission
    if (!examWindow.isKiosk()) {
      examWindow.setKiosk(true);
      console.log('[EXAM-WINDOW] Re-enabled kiosk mode on show (blocks Windows key)');
    }
    
    examWindow.focus();
    examWindow.moveTop();
  });
  
  // Monitor fullscreen state and re-enable if disabled
  // After submission, allow user to exit if they want, but we can still re-enable for security
  examWindow.on('leave-full-screen', () => {
    if (examWindow && !examWindow.isDestroyed()) {
      if (examSubmitted) {
        console.log('[EXAM-WINDOW] Fullscreen was exited after submission - allowing exit');
        // After submission, we allow user to exit fullscreen if they want
        // But we can still re-enable kiosk mode for security
        if (!examWindow.isKiosk()) {
          examWindow.setKiosk(true);
          console.log('[EXAM-WINDOW] Re-enabled kiosk mode after fullscreen exit (post-submission)');
        }
      } else {
        console.warn('[EXAM-WINDOW] Fullscreen was exited, re-enabling...');
        setTimeout(() => {
          if (examWindow && !examWindow.isDestroyed()) {
            examWindow.setFullScreen(true);
            // Also ensure kiosk mode is still enabled
            if (!examWindow.isKiosk()) {
              examWindow.setKiosk(true);
              console.log('[EXAM-WINDOW] Re-enabled kiosk mode after fullscreen exit');
            }
          }
        }, 100);
      }
    }
  });
  
  // Monitor kiosk mode state and re-enable if disabled
  // Note: Electron doesn't have a 'leave-kiosk' event, but we can check periodically
  // or rely on fullscreen monitoring
  
  examWindow.on('closed', () => {
    console.log('[EXAM-WINDOW] Exam window closed');
    examWindow = null;
    examSubmitted = false; // Reset flag when window is closed
    
    // Unlock system features when exam window closes
    if (isLocked) {
      unlockSystemFeatures();
      isLocked = false;
    }
  });
  
  // Prevent closing exam window with keyboard shortcuts and block all Windows shortcuts
  // IMPORTANT: Kill switch (Ctrl+Alt+Shift+`) must NOT be blocked here
  examWindow.webContents.on('before-input-event', (event, input) => {
    // ALLOW kill switch shortcut - must not be blocked
    // Ctrl+Alt+Shift+` (backtick) - this is handled by globalShortcut, not here
    // But we need to make sure we don't accidentally block it
    const isKillSwitch = (input.control || input.meta) && input.alt && input.shift && 
                         (input.key === '`' || input.key === 'Backquote' || input.key === '~');
    if (isKillSwitch) {
      // Allow kill switch to pass through - it's handled by globalShortcut
      console.log('[EXAM-WINDOW] Kill switch shortcut detected, allowing...');
      return; // Don't prevent, let globalShortcut handle it
    }
    
    // BLOCK Windows key FIRST - check multiple ways to detect it
    // Method 1: Check meta key flag (most common)
    if (input.meta && !isKillSwitch) {
      console.log(`[EXAM-WINDOW] 🚫 Blocked Windows key (meta=true): key=${input.key || 'none'}, code=${input.code || 'none'}`);
      event.preventDefault();
      return;
    }
    
    // Method 2: Check by code property (MetaLeft, MetaRight, OSLeft, OSRight)
    if (input.code === 'MetaLeft' || input.code === 'MetaRight' || 
        input.code === 'OSLeft' || input.code === 'OSRight') {
      console.log(`[EXAM-WINDOW] 🚫 Blocked Windows key by code: ${input.code}`);
      event.preventDefault();
      return;
    }
    
    // Method 3: Check by key property (Windows, Meta, OS)
    if (input.key === 'Meta' || input.key === 'OS' || input.key === 'Windows' || 
        input.key === 'Super' || input.key === 'Win') {
      console.log(`[EXAM-WINDOW] 🚫 Blocked Windows key by key name: ${input.key}`);
      event.preventDefault();
      return;
    }
    
    // Method 4: Check if Windows key is pressed alone (no other modifiers)
    // Windows key alone might not have a key value, but meta will be true
    // This is already covered by Method 1, but we add explicit check for safety
    if (input.meta && !input.control && !input.alt && !input.shift && 
        (!input.key || input.key === 'Meta' || input.key === 'OS')) {
      console.log(`[EXAM-WINDOW] 🚫 Blocked Windows key alone`);
      event.preventDefault();
      return;
    }
    
    // Block all Function keys (F1-F12)
    if (input.key && input.key.startsWith('F') && /^F\d+$/.test(input.key)) {
      console.log(`[EXAM-WINDOW] Blocked ${input.key} key press`);
      event.preventDefault();
      return;
    }
    
    // Escape key - ALLOWED (removed from block list)
    // Note: F11 is still blocked to prevent exiting fullscreen
    
    // Block Ctrl+Alt+Del (Security screen) - Note: May not be fully blockable on Windows
    if (input.key === 'Delete' && input.control && input.alt) {
      console.log('[EXAM-WINDOW] Blocked Ctrl+Alt+Del (Security screen)');
      event.preventDefault();
      return;
    }
    
    // Block Alt+F4 (close window)
    if (input.key === 'F4' && input.alt) {
      console.log('[EXAM-WINDOW] Blocked Alt+F4');
      event.preventDefault();
      return;
    }
    
    // Block Alt+Tab (switch windows)
    if (input.key === 'Tab' && input.alt && !input.shift) {
      console.log('[EXAM-WINDOW] Blocked Alt+Tab');
      event.preventDefault();
      return;
    }
    
    // Block Alt+Shift+Tab (switch windows reverse)
    if (input.key === 'Tab' && input.alt && input.shift) {
      console.log('[EXAM-WINDOW] Blocked Alt+Shift+Tab');
      event.preventDefault();
      return;
    }
    
    // Block Ctrl+Tab (switch tabs)
    if (input.key === 'Tab' && (input.control || input.meta)) {
      console.log('[EXAM-WINDOW] Blocked Ctrl+Tab');
      event.preventDefault();
      return;
    }
    
    // Block Ctrl+W (close tab)
    if (input.key === 'W' && (input.control || input.meta)) {
      console.log('[EXAM-WINDOW] Blocked Ctrl+W');
      event.preventDefault();
      return;
    }
    
    // Block Ctrl+Q (quit)
    if (input.key === 'Q' && (input.control || input.meta)) {
      console.log('[EXAM-WINDOW] Blocked Ctrl+Q');
      event.preventDefault();
      return;
    }
    
    // Block Ctrl+Shift+Esc (Task Manager)
    if (input.key === 'Escape' && input.control && input.shift) {
      console.log('[EXAM-WINDOW] Blocked Ctrl+Shift+Esc');
      event.preventDefault();
      return;
    }
    
    // Ctrl+Esc - ALLOWED (removed from block list)
    // Escape alone - ALLOWED (removed from block list)
    // Shift+Esc - ALLOWED (removed from block list)
    
    // Block Ctrl+Shift+I/J (DevTools)
    if ((input.key === 'I' || input.key === 'J') && input.control && input.shift) {
      console.log(`[EXAM-WINDOW] Blocked Ctrl+Shift+${input.key}`);
      event.preventDefault();
      return;
    }
    
    // Block Ctrl+U (View Source)
    if (input.key === 'U' && (input.control || input.meta)) {
      console.log('[EXAM-WINDOW] Blocked Ctrl+U');
      event.preventDefault();
      return;
    }
    
    // Block Ctrl+R / F5 (Refresh)
    if ((input.key === 'R' && (input.control || input.meta)) || input.key === 'F5') {
      console.log('[EXAM-WINDOW] Blocked Refresh');
      event.preventDefault();
      return;
    }
    
    // Block Ctrl+S (Save)
    if (input.key === 'S' && (input.control || input.meta)) {
      console.log('[EXAM-WINDOW] Blocked Ctrl+S');
      event.preventDefault();
      return;
    }
    
    // Block Ctrl+P (Print)
    if (input.key === 'P' && (input.control || input.meta)) {
      console.log('[EXAM-WINDOW] Blocked Ctrl+P');
      event.preventDefault();
      return;
    }
    
    // Block Ctrl+N (New Window)
    if (input.key === 'N' && (input.control || input.meta)) {
      console.log('[EXAM-WINDOW] Blocked Ctrl+N');
      event.preventDefault();
      return;
    }
    
    // Block Ctrl+T (New Tab)
    if (input.key === 'T' && (input.control || input.meta)) {
      console.log('[EXAM-WINDOW] Blocked Ctrl+T');
      event.preventDefault();
      return;
    }
    
    // Block Alt+Space (System menu)
    if (input.key === 'Space' && input.alt) {
      console.log('[EXAM-WINDOW] Blocked Alt+Space');
      event.preventDefault();
      return;
    }
    
    // Alt+Esc - ALLOWED (removed from block list)
    
    // Block Copy/Paste shortcuts
    if (input.key === 'C' && (input.control || input.meta) && !input.shift && !input.alt) {
      console.log('[EXAM-WINDOW] Blocked Ctrl+C (Copy)');
      event.preventDefault();
      return;
    }
    
    if (input.key === 'X' && (input.control || input.meta) && !input.shift && !input.alt) {
      console.log('[EXAM-WINDOW] Blocked Ctrl+X (Cut)');
      event.preventDefault();
      return;
    }
    
    if (input.key === 'V' && (input.control || input.meta) && !input.shift && !input.alt) {
      console.log('[EXAM-WINDOW] Blocked Ctrl+V (Paste)');
      event.preventDefault();
      return;
    }
    
    if (input.key === 'V' && (input.control || input.meta) && input.shift) {
      console.log('[EXAM-WINDOW] Blocked Ctrl+Shift+V (Paste plain text)');
      event.preventDefault();
      return;
    }
    
    if (input.key === 'Insert' && (input.control || input.meta)) {
      console.log('[EXAM-WINDOW] Blocked Ctrl+Insert (Copy)');
      event.preventDefault();
      return;
    }
    
    if (input.key === 'Insert' && input.shift) {
      console.log('[EXAM-WINDOW] Blocked Shift+Insert (Paste)');
      event.preventDefault();
      return;
    }
    
    // Language/IME switching - ALLOWED (removed from block list)
    // Alt+Shift and Ctrl+Shift are now allowed for language/IME switching
    
    // Alt+Shift+PrintScreen (High Contrast) - ALLOWED (removed from block list)
    
    // Windows key blocking is already handled at the top of the handler
    // This section is kept for reference but should not be reached if Windows key is detected
    
    // Block PrintScreen
    if (input.key === 'PrintScreen' || input.key === 'Print') {
      console.log('[EXAM-WINDOW] Blocked PrintScreen');
      event.preventDefault();
      return;
    }
    
    // Note: The following shortcuts cannot be blocked at Electron level:
    // - Win+Ctrl+D (Create virtual desktop) - Windows key limitation
    // - Win+Ctrl+Left/Right (Switch virtual desktop) - Windows key limitation
    // - Win+Ctrl+F4 (Close virtual desktop) - Windows key limitation
    // - Win+Space (Switch keyboard) - Windows key limitation
    // - Win+U (Ease of Access) - Windows key limitation
    // - Volume Up/Down/Mute - Hardware keys, may not be interceptable
    // - Brightness Up/Down - Hardware keys, may not be interceptable
    // - Media Play/Next/Prev - Hardware keys, may not be interceptable
    // - Power/Sleep key - Hardware key, cannot be blocked
    // - Shift x5 (Sticky Keys) - System-level accessibility feature
  });
}

function createWelcomeWindow() {
  console.log('[WINDOW-CREATE] 🏗️ Creating welcome window...');
  // Get icon path
  const iconPath = path.join(__dirname, 'assets', 'logo192.png');
  
  // Get primary display dimensions
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
  console.log(`[WINDOW-CREATE] 📺 Screen dimensions: ${screenWidth}x${screenHeight}`);
  
  // Calculate position: center horizontally, top vertically (50px from top)
  const windowWidth = 640;
  const windowHeight = 580;
  const x = Math.floor((screenWidth - windowWidth) / 2);
  const y = 50; // Position at top with 50px margin
  console.log(`[WINDOW-CREATE] 📐 Initial window size: ${windowWidth}x${windowHeight}, position: (${x}, ${y})`);
  
  welcomeWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x: x,
    y: y,
    minWidth: 500,
    minHeight: 400,
    maxWidth: 800,
    maxHeight: 1200,
    resizable: true, // Allow resizing for dynamic content
    frame: false, // No frame - Apple style
    transparent: false, // Solid background
    autoHideMenuBar: true,
    icon: iconPath,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false
    },
    show: false,
    center: false, // Don't center, use custom position
    title: 'IMS EXAM PCTU'
  });
  console.log('[WINDOW-CREATE] ✅ BrowserWindow created');

  welcomeWindow.loadFile('welcome.html');
  console.log('[WINDOW-CREATE] 📄 Loading welcome.html...');

  // Flag to track if window should be shown
  let windowReadyToShow = false;
  let contentReadyForDisplay = false;
  let windowShown = false;
  
  welcomeWindow.once('ready-to-show', () => {
    console.log('[WINDOW-CREATE] 🎯 ready-to-show event fired');
    windowReadyToShow = true;
    tryShowWindow();
    
    // Fallback: Show window after 1 second if content signal hasn't arrived
    setTimeout(() => {
      if (!windowShown) {
        console.log('[WINDOW-CREATE] ⚠️ Fallback: Showing window after timeout (content signal not received)');
        contentReadyForDisplay = true; // Force show
        tryShowWindow();
      }
    }, 1000);
  });
  
  welcomeWindow.webContents.once('did-finish-load', () => {
    console.log('[WINDOW-CREATE] 📄 did-finish-load event fired');
  });
  
  welcomeWindow.webContents.once('dom-ready', () => {
    console.log('[WINDOW-CREATE] 🎨 dom-ready event fired');
  });
  
  // Function to show window when both conditions are met
  function tryShowWindow() {
    if (!windowShown && windowReadyToShow && contentReadyForDisplay) {
      // Ensure window is positioned correctly when showing
      welcomeWindow.setPosition(x, y);
      console.log(`[WINDOW-CREATE] 📍 Setting position to (${x}, ${y})`);
      welcomeWindow.show();
      windowShown = true;
      console.log('[WINDOW-CREATE] 👁️ Window shown');
    } else {
      if (windowShown) {
        console.log('[WINDOW-CREATE] ⏭️ Window already shown, skipping');
      } else {
        console.log(`[WINDOW-CREATE] ⏳ Waiting for conditions: windowReadyToShow=${windowReadyToShow}, contentReadyForDisplay=${contentReadyForDisplay}`);
      }
    }
  }
  
  // IPC handler: wait for renderer to signal that content is ready
  ipcMain.on('content-ready-for-display', (event) => {
    console.log('[WINDOW-CREATE] 📨 Received content-ready-for-display signal from renderer');
    contentReadyForDisplay = true;
    tryShowWindow();
  });

  welcomeWindow.on('closed', () => {
    // When welcome window is closed, app continues running in tray
    welcomeWindow = null;
  });

  // Handle window resize request from renderer
  ipcMain.on('resize-window', (event, size) => {
    console.log(`[WINDOW-RESIZE] 📨 Received resize request: width=${size.width}, height=${size.height}`);
    if (welcomeWindow && !welcomeWindow.isDestroyed()) {
      // Get current window position
      const [currentX, currentY] = welcomeWindow.getPosition();
      const [currentWidth, currentHeight] = welcomeWindow.getSize();
      console.log(`[WINDOW-RESIZE] 📍 Current position: x=${currentX}, y=${currentY}, size=${currentWidth}x${currentHeight}`);
      
      // Skip resize if size is the same (prevent unnecessary resizes)
      if (currentWidth === size.width && currentHeight === size.height) {
        console.log(`[WINDOW-RESIZE] ⏭️ Skipping resize - size unchanged (${currentWidth}x${currentHeight})`);
        // Still update position to ensure centering (in case window was moved)
        const primaryDisplay = screen.getPrimaryDisplay();
        const { width: screenWidth } = primaryDisplay.workAreaSize;
        const newX = Math.floor((screenWidth - size.width) / 2);
        if (currentX !== newX) {
          welcomeWindow.setPosition(newX, currentY || 50);
          console.log(`[WINDOW-RESIZE] ✅ Position updated to center: (${newX}, ${currentY || 50})`);
        }
        return;
      }
      
      // Calculate new X position to keep centered horizontally
      const primaryDisplay = screen.getPrimaryDisplay();
      const { width: screenWidth } = primaryDisplay.workAreaSize;
      const newX = Math.floor((screenWidth - size.width) / 2);
      console.log(`[WINDOW-RESIZE] 📐 Screen width: ${screenWidth}, newX: ${newX}, newY: ${currentY || 50}`);
      
      // Keep Y position at top (50px), only change X to maintain center
      welcomeWindow.setPosition(newX, currentY || 50);
      welcomeWindow.setSize(size.width, size.height, false);
      console.log(`[WINDOW-RESIZE] ✅ Window resized and repositioned: ${size.width}x${size.height} at (${newX}, ${currentY || 50})`);
    } else {
      console.log(`[WINDOW-RESIZE] ❌ Welcome window not available or destroyed, ignoring resize request`);
    }
  });

  welcomeWindow.on('close', (event) => {
    // Prevent default close behavior - just hide
    event.preventDefault();
    welcomeWindow.hide();
    // App will continue running in background (tray)
  });
}

// Note: Students take exam in their own browser (Chrome, Cốc Cốc, Firefox, etc.)
// This app only provides background system lock features (Alt+Tab, Print Screen, etc.)
// No exam window is created - the app runs in the background/system tray

function lockSystemFeatures() {
  // Block global shortcuts (wrapped in try-catch to prevent crashes)
  // List of all Windows shortcuts to block
  const shortcutsToBlock = [
    // System shortcuts
    'CommandOrControl+Alt+Delete', // Task Manager
    'Alt+Tab', // Switch windows
    'Alt+Shift+Tab', // Switch windows (reverse)
    'CommandOrControl+Tab', // Switch tabs
    'CommandOrControl+Shift+Tab', // Switch tabs (reverse)
    'Alt+F4', // Close window
    'CommandOrControl+Q', // Quit
    'CommandOrControl+W', // Close tab
    'CommandOrControl+Shift+Esc', // Task Manager
    'CommandOrControl+Shift+N', // New incognito window
    'CommandOrControl+N', // New window
    'CommandOrControl+T', // New tab
    'CommandOrControl+Shift+T', // Reopen closed tab
    
    // Function keys
    'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
    
    // Developer tools
    'CommandOrControl+Shift+I', // DevTools
    'CommandOrControl+Shift+J', // Console
    'CommandOrControl+Shift+C', // Inspect element
    'CommandOrControl+U', // View source
    
    // Browser shortcuts
    'CommandOrControl+R', // Refresh
    'CommandOrControl+Shift+R', // Hard refresh
    'CommandOrControl+S', // Save
    'CommandOrControl+P', // Print
    'CommandOrControl+Shift+P', // Print (alternative)
    'CommandOrControl+O', // Open file
    'CommandOrControl+H', // History
    'CommandOrControl+J', // Downloads
    'CommandOrControl+K', // Search
    'CommandOrControl+L', // Address bar
    'CommandOrControl+D', // Bookmark
    'CommandOrControl+Shift+D', // Bookmark all tabs
    'CommandOrControl+B', // Show bookmarks
    'CommandOrControl+Shift+B', // Toggle bookmarks bar
    'CommandOrControl+E', // Search
    'CommandOrControl+F', // Find (allow this one for exam questions)
    'CommandOrControl+G', // Find next
    'CommandOrControl+Shift+G', // Find previous
    
    // Screenshot
    'PrintScreen',
    'CommandOrControl+PrintScreen',
    'Alt+PrintScreen',
    
    // Navigation
    'CommandOrControl+Left', // Back
    'CommandOrControl+Right', // Forward
    'CommandOrControl+Shift+Left', // Back
    'CommandOrControl+Shift+Right', // Forward
    'Alt+Left', // Back
    'Alt+Right', // Forward
    'Alt+Home', // Home page
    
    // Zoom - ALLOWED (removed from block list)
    // 'CommandOrControl+Plus', // Zoom in - ALLOWED
    // 'CommandOrControl+Minus', // Zoom out - ALLOWED
    // 'CommandOrControl+0', // Reset zoom - ALLOWED
    // 'CommandOrControl+Shift+Plus', // Zoom in - ALLOWED
    // 'CommandOrControl+Shift+Minus', // Zoom out - ALLOWED
    
    // Other
    'CommandOrControl+Shift+Delete', // Clear browsing data
    'CommandOrControl+Shift+M', // Switch account
    'CommandOrControl+Shift+O', // Bookmarks manager
    'CommandOrControl+Shift+W', // Close window
    'CommandOrControl+M', // Minimize (macOS)
    'CommandOrControl+H', // Hide (macOS)
    
    // System window management
    'Alt+Space', // System menu
    'Alt+Esc', // Switch windows in background
    'CommandOrControl+Esc', // Start Menu (alternative to Win)
    
    // Copy/Paste shortcuts
    'CommandOrControl+C', // Copy
    'CommandOrControl+X', // Cut
    'CommandOrControl+V', // Paste
    'CommandOrControl+Shift+V', // Paste plain text
    'CommandOrControl+Insert', // Copy (alternative)
    'Shift+Insert', // Paste (alternative)
    
    // Language/IME switching - ALLOWED (removed from block list)
    // 'Alt+Shift', // Switch language - ALLOWED
    // 'CommandOrControl+Shift', // Switch IME - ALLOWED
    
    // Accessibility shortcuts - ALLOWED (removed from block list)
    // 'Alt+Shift+PrintScreen', // High Contrast - ALLOWED
    // Note: Shift x5 (Sticky Keys) cannot be blocked via globalShortcut
    // Note: Win+U (Ease of Access) cannot be blocked (Windows key limitation)
    
    // Windows Virtual Desktop shortcuts (Note: Win key combinations cannot be fully blocked)
    // These are listed for documentation, but may not be blockable:
    // 'Meta+Control+D', // Create new virtual desktop
    // 'Meta+Control+Left', // Switch virtual desktop left
    // 'Meta+Control+Right', // Switch virtual desktop right
    // 'Meta+Control+F4', // Close virtual desktop
  ];
  
  // Kill switch shortcuts - must NOT be blocked, will be registered separately
  const killSwitchShortcuts = [
    'CommandOrControl+Alt+Shift+`',
    'Ctrl+Alt+Shift+`',
    'CommandOrControl+Alt+K' // Fallback
  ];
  
  // Register all shortcuts (except kill switch shortcuts)
  shortcutsToBlock.forEach(shortcut => {
    // Skip kill switch shortcuts - they must remain available
    if (killSwitchShortcuts.includes(shortcut)) {
      console.log(`[LOCK] ⏭️ Skipping kill switch shortcut: ${shortcut} (will be registered separately)`);
      return;
    }
    
    try {
      // Unregister first if already registered (to avoid conflicts)
      if (globalShortcut.isRegistered(shortcut)) {
        globalShortcut.unregister(shortcut);
      }
      
      const registered = globalShortcut.register(shortcut, () => {
        console.log(`[LOCK] Blocked global shortcut: ${shortcut}`);
        return false;
      });
      
      if (registered) {
        console.log(`[LOCK] ✅ Registered global shortcut: ${shortcut}`);
      } else {
        console.warn(`[LOCK] ⚠️ Failed to register global shortcut: ${shortcut}`);
      }
    } catch (e) {
      console.warn(`[LOCK] ⚠️ Error registering shortcut ${shortcut}:`, e.message);
      // Some shortcuts might not be registerable (like Ctrl+Alt+Del on Windows)
      // They are still blocked in before-input-event handler
    }
  });
  
  // Note: Windows key (Super) cannot be blocked via globalShortcut on Windows
  // It requires system-level hooks which are not available in Electron
  // The kiosk mode and fullscreen should help prevent Windows key usage
  
  // Always re-register kill switch AFTER locking (to ensure it overrides any conflicts)
  // This ensures kill switch is always available, even when system is locked
  console.log('[LOCK] Registering kill switch shortcut (must remain available)...');
  registerKillSwitch();
  
  // Disable Windows key via Registry (requires admin, but most effective)
  // This is in addition to kiosk mode and before-input-event blocking
  console.log('[LOCK] Attempting to disable Windows key via Registry...');
  disableWindowsKey();
}



const KILL_SWITCH_PASSWORD_HASH = '6c8bbc73e8ad175b795999ba73d5537a15d28e01e8dc2087777b0ddf55e6992a';

// Function to hash password for comparison
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// Store reference to password window for closing
let passwordWindowRef = null;

// IPC handler to close kill switch window
ipcMain.on('kill-switch-close', (event) => {
  if (passwordWindowRef && !passwordWindowRef.isDestroyed()) {
    passwordWindowRef.close();
    passwordWindowRef = null;
  }
});

// IPC handler for kill switch password verification
ipcMain.on('kill-switch-verify', (event, password) => {
  // Hash the provided password and compare with stored hash
  const passwordHash = hashPassword(password);
  
  if (passwordHash === KILL_SWITCH_PASSWORD_HASH) {
    console.log('[KILL-SWITCH] ✅ Password correct, quitting application...');
    event.reply('kill-switch-success');
    
    // Quit application immediately
    setTimeout(() => {
      app.isQuitting = true;
      unlockSystemFeatures();
      stopProcessMonitoring();
      stopHealthServer();
      app.quit();
      // Force exit if quit doesn't work
      setTimeout(() => {
        process.exit(0);
      }, 1000);
    }, 100);
  } else {
    console.log('[KILL-SWITCH] ❌ Incorrect password');
    event.reply('kill-switch-error');
  }
});

// Kill switch shortcut handler - Always registered (works even when locked)
let killSwitchRegistered = false;

function registerKillSwitch() {
  try {
    // First, unregister any existing kill switch shortcuts
    try {
      globalShortcut.unregister('CommandOrControl+Alt+Shift+`');
      globalShortcut.unregister('CommandOrControl+Alt+Shift+~');
      globalShortcut.unregister('Ctrl+Alt+Shift+`');
      globalShortcut.unregister('Ctrl+Alt+Shift+~');
    } catch (e) {
      // Ignore errors if shortcuts don't exist
    }
    
    // Register Ctrl+Alt+Shift+~ (tilde key)
    // Note: On most keyboards, ~ is Shift+` (backtick)
    // So Ctrl+Alt+Shift+~ means: Ctrl+Alt+Shift+(Shift+`) = Ctrl+Alt+Shift+Shift+`
    // But that doesn't work, so we need to use just backtick without extra Shift
    // Actually, to get ~, user presses Shift+`, so the shortcut should be Ctrl+Alt+Shift+`
    const shortcuts = [
      'CommandOrControl+Alt+Shift+`',      // Backtick - This should work for Ctrl+Alt+Shift+`
      'Ctrl+Alt+Shift+`',                  // Windows/Linux specific
      'CommandOrControl+Alt+Shift+Backquote' // Alternative format
    ];
    
    let registered = false;
    
    for (const shortcut of shortcuts) {
      try {
        // Check if already registered
        if (globalShortcut.isRegistered(shortcut)) {
          console.log(`[KILL-SWITCH] Shortcut ${shortcut} is already registered, unregistering first...`);
          globalShortcut.unregister(shortcut);
        }
        
        const result = globalShortcut.register(shortcut, () => {
          console.log(`[KILL-SWITCH] 🔥 Kill switch activated via ${shortcut}!`);
          showPasswordDialog();
        });
        
        if (result) {
          console.log(`[KILL-SWITCH] ✅ Successfully registered kill switch shortcut: ${shortcut}`);
          killSwitchRegistered = true;
          registered = true;
          
          // Verify it's actually registered
          if (globalShortcut.isRegistered(shortcut)) {
            console.log(`[KILL-SWITCH] ✅ Verified: shortcut ${shortcut} is active`);
          } else {
            console.warn(`[KILL-SWITCH] ⚠️ Warning: shortcut ${shortcut} registration returned true but isRegistered() returns false`);
          }
          
          break; // Successfully registered, no need to try others
        } else {
          console.warn(`[KILL-SWITCH] ⚠️ Failed to register shortcut: ${shortcut} (returned false)`);
        }
      } catch (e) {
        console.warn(`[KILL-SWITCH] ❌ Error registering shortcut ${shortcut}:`, e.message);
      }
    }
    
    if (!registered) {
      console.error('[KILL-SWITCH] ❌ Failed to register kill switch with any shortcut variation!');
      // Try a simpler alternative for testing: Ctrl+Alt+K
      try {
        const fallback = 'CommandOrControl+Alt+K';
        if (globalShortcut.isRegistered(fallback)) {
          globalShortcut.unregister(fallback);
        }
        const fallbackResult = globalShortcut.register(fallback, () => {
          console.log(`[KILL-SWITCH] 🔥 Kill switch activated via fallback ${fallback}!`);
          showPasswordDialog();
        });
        if (fallbackResult) {
          console.log(`[KILL-SWITCH] ✅ Registered fallback shortcut: ${fallback}`);
          killSwitchRegistered = true;
        }
      } catch (e) {
        console.error('[KILL-SWITCH] ❌ Failed to register even fallback shortcut:', e.message);
      }
    }
  } catch (e) {
    console.error('[KILL-SWITCH] ❌ Error in registerKillSwitch:', e.message);
  }
}

// Show password input dialog
function showPasswordDialog() {
  // Get primary display for centering
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
  
  // Create a window for password input - no frame, Apple style
  const passwordWindow = new BrowserWindow({
    width: 420,
    height: 280,
    frame: false, // No frame - only body
    transparent: true, // Transparent background - chỉ container có nền
    resizable: false,
    alwaysOnTop: true,
    modal: false,
    show: false,
    center: true,
    backgroundColor: '#00000000', // Fully transparent background
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  
  // Store reference for IPC close handler
  passwordWindowRef = passwordWindow;
  
  // Clear reference when window closes
  passwordWindow.on('closed', () => {
    passwordWindowRef = null;
  });

  // Create HTML content for password input
  const passwordHTML = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Kill Switch</title>
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        
        html, body {
          width: 100%;
          height: 100%;
          overflow: hidden; /* Bỏ cuộn */
          margin: 0;
          padding: 0;
        }
        
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: transparent; /* Bỏ nền - chỉ container có nền */
          display: flex;
          align-items: center;
          justify-content: center;
          -webkit-app-region: drag; /* Cho phép kéo window */
        }
        
        .container {
          background: white;
          padding: 30px;
          border-radius: 12px;
          box-shadow: 0 4px 20px rgba(0,0,0,0.15);
          width: 100%;
          max-width: 400px;
          -webkit-app-region: no-drag; /* Không kéo được phần tử bên trong */
          pointer-events: auto; /* Đảm bảo có thể click */
        }
        h3 {
          margin-top: 0;
          margin-bottom: 10px;
          color: #333;
          font-size: 18px;
          font-weight: 600;
        }
        
        p {
          color: #666;
          margin-bottom: 15px;
          font-size: 14px;
        }
        input {
          width: 100%;
          padding: 12px;
          margin: 10px 0;
          border: 1px solid #ddd;
          border-radius: 6px;
          font-size: 14px;
          box-sizing: border-box;
          -webkit-app-region: no-drag; /* Đảm bảo input có thể tương tác */
          pointer-events: auto;
        }
        input:focus {
          outline: none;
          border-color: #007bff;
        }
        .buttons {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          margin-top: 15px;
        }
        button {
          padding: 8px 20px;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 14px;
          -webkit-app-region: no-drag; /* Đảm bảo button có thể click */
          pointer-events: auto; /* Đảm bảo click hoạt động */
          position: relative;
          z-index: 10;
        }
        .btn-cancel {
          background: #6c757d;
          color: white;
        }
        .btn-cancel:hover {
          background: #5a6268;
        }
        .btn-confirm {
          background: #dc3545;
          color: white;
        }
        .btn-confirm:hover {
          background: #c82333;
        }
        .error {
          color: #dc3545;
          font-size: 12px;
          margin-top: 5px;
          display: none;
        }
        .success {
          color: #28a745;
          font-size: 12px;
          margin-top: 5px;
          display: none;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h3>IMS EXAM PCTU - Kill Switch</h3>
        <input type="password" id="password" placeholder="" autofocus>
        <div class="error" id="error">401 - Unauthorized</div>
        <div class="success" id="success">Mật khẩu đúng! Đang thoát...</div>
        <div class="buttons">
          <button class="btn-cancel" id="cancelBtn">Hủy</button>
          <button class="btn-confirm" id="confirmBtn">Xác nhận</button>
        </div>
      </div>
      <script>
        const { ipcRenderer, remote } = require('electron');
        
        function checkPassword() {
          const password = document.getElementById('password').value;
          const errorDiv = document.getElementById('error');
          const successDiv = document.getElementById('success');
          
          errorDiv.style.display = 'none';
          successDiv.style.display = 'none';
          
          // Send password to main process for verification
          ipcRenderer.send('kill-switch-verify', password);
        }
        
        function closeWindow() {
          try {
            const { remote } = require('electron');
            const win = remote.getCurrentWindow();
            if (win && !win.isDestroyed()) {
              win.close();
            }
          } catch (e) {
            console.error('Error closing window with remote:', e);
            // Fallback: try IPC
            try {
              ipcRenderer.send('kill-switch-close');
            } catch (ipcError) {
              console.error('Error sending IPC close:', ipcError);
            }
          }
        }
        
        // Add event listeners for buttons
        document.addEventListener('DOMContentLoaded', () => {
          const cancelBtn = document.getElementById('cancelBtn');
          const confirmBtn = document.getElementById('confirmBtn');
          
          if (cancelBtn) {
            cancelBtn.addEventListener('click', (e) => {
              e.preventDefault();
              e.stopPropagation();
              closeWindow();
            });
          }
          
          if (confirmBtn) {
            confirmBtn.addEventListener('click', (e) => {
              e.preventDefault();
              e.stopPropagation();
              checkPassword();
            });
          }
        });
        
        // Also add listeners immediately (in case DOMContentLoaded already fired)
        setTimeout(() => {
          const cancelBtn = document.getElementById('cancelBtn');
          const confirmBtn = document.getElementById('confirmBtn');
          
          if (cancelBtn && !cancelBtn.onclick) {
            cancelBtn.addEventListener('click', (e) => {
              e.preventDefault();
              e.stopPropagation();
              closeWindow();
            });
          }
          
          if (confirmBtn && !confirmBtn.onclick) {
            confirmBtn.addEventListener('click', (e) => {
              e.preventDefault();
              e.stopPropagation();
              checkPassword();
            });
          }
        }, 100);
        
        // Listen for verification result
        ipcRenderer.on('kill-switch-success', () => {
          const successDiv = document.getElementById('success');
          successDiv.style.display = 'block';
          document.getElementById('password').disabled = true;
          // Window will close automatically when app quits
        });
        
        ipcRenderer.on('kill-switch-error', () => {
          const errorDiv = document.getElementById('error');
          errorDiv.style.display = 'block';
          document.getElementById('password').value = '';
          document.getElementById('password').focus();
        });
        
        document.getElementById('password').addEventListener('keypress', function(e) {
          if (e.key === 'Enter') {
            checkPassword();
          }
        });
      </script>
    </body>
    </html>
  `;

  passwordWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(passwordHTML));
  
  passwordWindow.once('ready-to-show', () => {
    passwordWindow.show();
    passwordWindow.focus();
  });

  passwordWindow.on('closed', () => {
    // Window closed without password
  });
}

function unlockSystemFeatures() {
  // Enable Windows key via Registry (restore original state)
  if (windowsKeyDisabled) {
    console.log('[UNLOCK] Restoring Windows key via Registry...');
    enableWindowsKey();
  }
  
  // Unregister all shortcuts except kill switch
  globalShortcut.unregisterAll();
  // Re-register kill switch after unlock (to ensure it's always available)
  registerKillSwitch();
}

// Create system tray
function createTray() {
  const fs = require('fs');
  let trayIcon;
  
  // Try to find an icon file - use PNG for tray (ICO might have loading issues)
  const iconPaths = [
    path.join(__dirname, 'assets', 'logo192.png'),  // Best for tray (PNG format, good size)
    path.join(__dirname, 'assets', 'logo512.png'),  // Fallback (larger PNG)
    path.join(__dirname, 'assets', 'favicon.ico')    // Last resort (ICO format - may have issues)
  ];
  
  for (const iconPath of iconPaths) {
    try {
      if (fs.existsSync(iconPath)) {
        trayIcon = iconPath;
        console.log('Found tray icon:', trayIcon);
        break;
      }
    } catch (e) {
      // Continue to next path
      console.warn('Error checking icon path:', iconPath, e.message);
    }
  }
  
  // Create tray with icon
  try {
    if (trayIcon) {
      tray = new Tray(trayIcon);
      console.log('Tray created successfully with icon:', trayIcon);
    } else {
      console.warn('No icon found, trying default paths...');
      // Try to use logo192.png as fallback
      try {
        const defaultIcon = path.join(__dirname, 'assets', 'logo192.png');
        if (fs.existsSync(defaultIcon)) {
          tray = new Tray(defaultIcon);
          console.log('Tray created with default icon:', defaultIcon);
        } else {
          console.error('Default icon not found:', defaultIcon);
          return;
        }
      } catch (e2) {
        console.error('Failed to create tray with default icon:', e2.message);
        return;
      }
    }
  } catch (e) {
    console.error('Could not create tray icon:', e.message);
    // Tray will be null, but app will still work
    return;
  }

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Hiển thị',
      click: () => {
        if (welcomeWindow && !welcomeWindow.isDestroyed()) {
          welcomeWindow.show();
        } else if (!welcomeWindow) {
          createWelcomeWindow();
        }
      }
    },
    {
      label: 'Ẩn',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip('IMS EXAM PCTU - Trình duyệt thi an toàn');
  tray.setContextMenu(contextMenu);

  // Show welcome window on tray icon click
  tray.on('click', () => {
    if (welcomeWindow && !welcomeWindow.isDestroyed()) {
      welcomeWindow.show();
    } else if (!welcomeWindow) {
      createWelcomeWindow();
    }
  });
}

app.whenReady().then(() => {
  startHealthServer();
  createWelcomeWindow();
  createTray();
  startProcessMonitoring(); // Start process monitoring for automatic safety checks
  registerKillSwitch(); // Register kill switch shortcut (always active)
  
  // Verify kill switch registration after a short delay
  setTimeout(() => {
    console.log('[KILL-SWITCH] 🔍 Checking kill switch registration status...');
    const shortcuts = ['CommandOrControl+Alt+Shift+`', 'Ctrl+Alt+Shift+`', 'CommandOrControl+Alt+K'];
    for (const shortcut of shortcuts) {
      if (globalShortcut.isRegistered(shortcut)) {
        console.log(`[KILL-SWITCH] ✅ Verified active: ${shortcut}`);
      }
    }
  }, 1000);

  app.on('activate', () => {
    // On macOS, re-create welcome window when dock icon is clicked
    if (BrowserWindow.getAllWindows().length === 0) {
      createWelcomeWindow();
    } else {
      // Show existing window
      BrowserWindow.getAllWindows().forEach(window => {
        if (!window.isDestroyed()) {
          window.show();
        }
      });
    }
  });
});

// Handle window-all-closed: keep app running in tray
app.on('window-all-closed', (e) => {
  // On Windows and Linux, don't quit when all windows are closed (keep in tray)
  if (process.platform !== 'darwin') {
    // Prevent default quit behavior - app will stay running in tray
    // Only quit if explicitly requested via tray menu or app.isQuitting flag
    if (!app.isQuitting) {
      e.preventDefault();
      return;
    }
    stopHealthServer();
    app.quit();
  } else {
    // On macOS, apps typically stay active even when all windows are closed
    if (!app.isQuitting) {
      e.preventDefault();
      return;
    }
  }
});

app.on('will-quit', () => {
  unlockSystemFeatures();
  stopProcessMonitoring();
  stopHealthServer();
});

// Handle exit request (can be password-protected)
ipcMain.on('request-exit', (event, password) => {
  // If exam is in progress, unlock first
  if (isLocked) {
    unlockSystemFeatures();
    isLocked = false;
  }
  // Close welcome window if open
  if (welcomeWindow && !welcomeWindow.isDestroyed()) {
    welcomeWindow.close();
  }
});

// Prevent app from quitting normally when windows are closed (keep running in tray)
app.on('before-quit', (event) => {
  // Set flag to allow quit
  app.isQuitting = true;
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  // Don't exit on error - keep app running
});

