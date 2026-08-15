const cookieContainer = document.getElementById('cookieContainer');
const cookieImg = document.getElementById('cookieImg');

let cookieSize = 40; // 可调饼干大小，默认与主进程一致
// 初始设置CSS变量，确保图片在IPC到达前就正确渲染
document.documentElement.style.setProperty('--cookie-size', cookieSize + 'px');
// 与主进程 COOKIE_PADDING 保持一致：窗口大小 = cookieSize + COOKIE_PADDING*2
// 饼干图片居中显示在窗口中，物理边界检测需基于饼干实际位置
const COOKIE_PADDING = 18;
let moveMode = 'free'; // 'free' | 'gravity'
let petGroundY = 0;
let windowScreenX = 0;
let windowScreenY = 0;

// 获取窗口大小（含 padding）
function getWindowSize() {
    return cookieSize + COOKIE_PADDING * 2;
}

// 物理状态
let vx = 0;
let vy = 0;
let isDragging = false;
let dragStartScreenX = 0;
let dragStartScreenY = 0;
let dragStartWinX = 0;
let dragStartWinY = 0;

// 拖拽速度追踪
let lastDragScreenX = 0;
let lastDragScreenY = 0;
let lastDragTime = 0;
let dragVelocityX = 0;
let dragVelocityY = 0;

// 拖拽超时
let dragStartTime = 0;
const DRAG_TIMEOUT = 10000;
let dragTimeoutTimer = null;

// 吃饼干动画
let isEating = false;
let cookieEatenReported = false;

// ===== IPC 通信 =====
if (window.electronAPI) {
    window.electronAPI.onCookieConfig((config) => {
        if (config.moveMode !== undefined) moveMode = config.moveMode;
        if (config.petGroundY !== undefined) petGroundY = config.petGroundY;
        if (config.cookieSize !== undefined) {
            cookieSize = config.cookieSize;
            // 通过 CSS 变量控制饼干图片大小，窗口大小由主进程管理（含 padding）
            document.documentElement.style.setProperty('--cookie-size', cookieSize + 'px');
        }
    });

    window.electronAPI.onPetPosition((pos) => {
        // 只接受有效的地面位置，且不允许地面位置变高（防止饼干跳到半空）
        if (pos.groundY !== undefined && pos.groundY > 0) {
            // 只接受更低（Y值更大）的地面位置，防止地面变高导致饼干跳到半空
            if (petGroundY === 0 || pos.groundY >= petGroundY) {
                petGroundY = pos.groundY;
            }
        }
    });
}

// ===== 右键清理 =====
cookieContainer.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (window.electronAPI) {
        window.electronAPI.requestCloseCookie();
    }
});

// ===== 拖拽逻辑 =====
cookieContainer.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    isDragging = true;
    dragStartTime = Date.now();
    cookieContainer.classList.add('dragging');

    const [winX, winY] = window.electronAPI.getCookieWindowPos();
    windowScreenX = winX;
    windowScreenY = winY;

    dragStartScreenX = e.screenX;
    dragStartScreenY = e.screenY;
    dragStartWinX = winX;
    dragStartWinY = winY;

    lastDragScreenX = e.screenX;
    lastDragScreenY = e.screenY;
    lastDragTime = performance.now();
    dragVelocityX = 0;
    dragVelocityY = 0;

    if (dragTimeoutTimer) clearTimeout(dragTimeoutTimer);
    dragTimeoutTimer = setTimeout(() => {
        if (isDragging && window.electronAPI) {
            window.electronAPI.notifyCookieDragTimeout();
        }
    }, DRAG_TIMEOUT);
});

document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    e.preventDefault();

    const newX = dragStartWinX + (e.screenX - dragStartScreenX);
    const newY = dragStartWinY + (e.screenY - dragStartScreenY);

    windowScreenX = newX;
    windowScreenY = newY;
    window.electronAPI.setCookieWindowPos(newX, newY);

    const now = performance.now();
    const dt = Math.max(now - lastDragTime, 1);
    dragVelocityX = (e.screenX - lastDragScreenX) / dt;
    dragVelocityY = (e.screenY - lastDragScreenY) / dt;
    lastDragScreenX = e.screenX;
    lastDragScreenY = e.screenY;
    lastDragTime = now;
});

document.addEventListener('mouseup', (e) => {
    if (!isDragging) return;
    isDragging = false;
    if (dragTimeoutTimer) {
        clearTimeout(dragTimeoutTimer);
        dragTimeoutTimer = null;
    }
    cookieContainer.classList.remove('dragging');

    const dragDuration = Date.now() - dragStartTime;
    if (dragDuration > DRAG_TIMEOUT && window.electronAPI) {
        window.electronAPI.notifyCookieDragTimeout();
    }

    if (moveMode === 'gravity') {
        vx = Math.max(-2.0, Math.min(2.0, dragVelocityX));
        vy = Math.max(-2.0, Math.min(2.0, dragVelocityY));
        if (Math.abs(vx) < 0.05 && Math.abs(vy) < 0.05) {
            vx = (Math.random() < 0.5 ? -1 : 1) * 0.3;
            vy = -(0.3 + Math.random() * 0.2);
        }
    } else {
        // 使用实际鼠标拖拽速度，让惯性沿拖拽方向衰减
        vx = Math.max(-1.0, Math.min(1.0, dragVelocityX));
        vy = Math.max(-1.0, Math.min(1.0, dragVelocityY));
        if (Math.abs(vx) < 0.005 && Math.abs(vy) < 0.005) {
            vx = 0;
            vy = 0;
        }
    }
});

// ===== 物理循环 =====
let lastTime = performance.now();
function physicsLoop(now) {
    const dt = Math.min(now - lastTime, 50); // 限制最大dt防止瞬移
    lastTime = now;

    if (!isDragging && !isEating && dt > 0) {
        updatePhysics(dt);
    }

    if (window.electronAPI) {
        window.electronAPI.sendCookiePosition(windowScreenX, windowScreenY);
    }

    requestAnimationFrame(physicsLoop);
}

function updatePhysics(dt) {
    const availLeft = screen.availLeft || 0;
    const availTop = screen.availTop || 0;
    const availRight = availLeft + (screen.availWidth || screen.width);
    const availBottom = availTop + (screen.availHeight || screen.height);
    // 饼干图片在窗口中的偏移：窗口顶部 + padding = 饼干顶部
    // 边界检测基于饼干实际位置，让饼干图片（而非透明 padding）不超出屏幕
    const pad = COOKIE_PADDING;

    if (moveMode === 'gravity') {
        const gravity = 0.002;
        vy += gravity * dt;

        let newX = windowScreenX + vx * dt;
        let newY = windowScreenY + vy * dt;

        // 地面检测：桌宠地面优先，回退到屏幕底部
        // 饼干底部 = 窗口顶部 + pad + cookieSize，贴地时窗口顶部 = groundY - pad - cookieSize
        const groundY = petGroundY > 0 ? petGroundY : (availBottom - pad);
        if (newY + pad + cookieSize >= groundY) {
            newY = groundY - pad - cookieSize;
            if (Math.abs(vy) > 0.1) {
                vy = -vy * 0.6; // 反弹系数
                vx *= 0.7;
                // 衰减，防止弹跳无限循环
                if (Math.abs(vy) < 0.5 && Math.abs(vx) < 0.01) {
                    vy = 0;
                }
            } else {
                vy = 0;
                vx *= 0.8;
                if (Math.abs(vx) < 0.01) vx = 0;
            }
        }

        // 边界反弹（基于饼干实际位置）
        if (newX + pad < availLeft) {
            newX = availLeft - pad;
            vx = Math.abs(vx) * 0.4;
        } else if (newX + pad + cookieSize > availRight) {
            newX = availRight - pad - cookieSize;
            vx = -Math.abs(vx) * 0.4;
        }
        if (newY + pad < availTop) {
            newY = availTop - pad;
            vy = Math.abs(vy) * 0.4;
        }

        windowScreenX = newX;
        windowScreenY = newY;
        window.electronAPI.setCookieWindowPos(Math.round(newX), Math.round(newY));

    } else {
        // 全屏模式：无重力，拖拽后微弱惯性
        if (Math.abs(vx) > 0.001 || Math.abs(vy) > 0.001) {
            let newX = windowScreenX + vx * dt;
            let newY = windowScreenY + vy * dt;

            vx *= 0.98;
            vy *= 0.98;

            if (newX + pad < availLeft) {
                newX = availLeft - pad;
                vx = Math.abs(vx) * 0.3;
            } else if (newX + pad + cookieSize > availRight) {
                newX = availRight - pad - cookieSize;
                vx = -Math.abs(vx) * 0.3;
            }
            if (newY + pad < availTop) {
                newY = availTop - pad;
                vy = Math.abs(vy) * 0.3;
            } else if (newY + pad + cookieSize > availBottom) {
                newY = availBottom - pad - cookieSize;
                vy = -Math.abs(vy) * 0.3;
            }

            windowScreenX = newX;
            windowScreenY = newY;
            window.electronAPI.setCookieWindowPos(Math.round(newX), Math.round(newY));

            if (Math.abs(vx) < 0.001 && Math.abs(vy) < 0.001) {
                vx = 0;
                vy = 0;
            }
        }
    }
}

// ===== 吃饼干动画 =====
function playEatAnimation() {
    isEating = true;
    cookieContainer.classList.add('eating');
    if (!cookieEatenReported && window.electronAPI) {
        cookieEatenReported = true;
        // 3秒后通知饼干被吃掉（与cookie CSS动画时长一致）
        setTimeout(() => {
            if (window.electronAPI) {
                window.electronAPI.notifyCookieEaten();
            }
        }, 3000);
    }
}

if (window.electronAPI) {
    window.electronAPI.onEatCookie(() => {
        playEatAnimation();
    });
}

// ===== 启动 =====
if (window.electronAPI) {
    const [x, y] = window.electronAPI.getCookieWindowPos();
    windowScreenX = x;
    windowScreenY = y;
}

requestAnimationFrame(physicsLoop);
