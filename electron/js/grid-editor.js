// ============================================================
// 网格编辑器交互逻辑 - 桌宠项目
// 依赖：grid-system.js（需先加载，提供 petGrid / ROOM_TYPES /
//       FURNITURE_TYPES / REQUIRED_FURNITURE 及各类网格操作函数）
// 提供编辑器界面的地块选择、点击/拖拽绘制、尺寸调整、保存等交互
// ============================================================

// ===== 编辑器状态变量 =====
let editorSelectedTile = null;  // 当前选中的地块类型
let editorIsEraser = false;     // 是否橡皮擦模式（已弃用，保留兼容）
let editorCellSize = 30;        // 编辑器中的格子大小
let editorIsDragging = false;   // 是否正在拖拽绘制
let editorDrawMode = 'point';   // 批量编辑模式：'point' | 'line' | 'rect'
let editorWallType = 'normal';  // 当前选择的墙类型：'normal' | 'double'
let editorMirrorFurniture = false; // 放置家具时是否水平镜像
let editorDragStartCol = -1;    // 拖拽起始列（线/面模式用）
let editorDragStartRow = -1;    // 拖拽起始行（线/面模式用）

// 是否已初始化（避免重复绑定事件）
let editorInitialized = false;

// ===== DOM 元素引用（在 initGridEditor 中赋值）=====
let gridEditorOverlay = null;
let gridEditorToolbar = null;
let gridEditorModeToolbar = null; // 批量模式工具栏
let gridColsInput = null;
let gridRowsInput = null;
let gridCellSizeInput = null;
let applyGridSizeBtn = null;
let resetGridBtn = null;
let furnitureValidation = null;
let gridEditorCanvas = null;
let gridCanvasInner = null;
let saveGridBtn = null;
let closeGridEditorBtn = null;
let closeGridEditorHeader = null;  // 头部关闭按钮（#closeGridEditor）


// ============================================================
// 初始化编辑器
// 获取 DOM 引用、生成地块按钮、绑定事件监听器
// 在页面加载时调用
// ============================================================
function initGridEditor() {
    // 避免重复初始化
    if (editorInitialized) return;
    editorInitialized = true;

    // 获取所有 DOM 元素引用
    gridEditorOverlay = document.getElementById('gridEditorOverlay');
    gridEditorToolbar = document.getElementById('gridEditorToolbar');
    gridEditorModeToolbar = document.getElementById('gridEditorModeToolbar');
    gridColsInput = document.getElementById('gridColsInput');
    gridRowsInput = document.getElementById('gridRowsInput');
    gridCellSizeInput = document.getElementById('gridCellSizeInput');
    applyGridSizeBtn = document.getElementById('applyGridSizeBtn');
    resetGridBtn = document.getElementById('resetGridBtn');
    furnitureValidation = document.getElementById('furnitureValidation');
    gridEditorCanvas = document.getElementById('gridEditorCanvas');
    gridCanvasInner = document.getElementById('gridCanvasInner');
    saveGridBtn = document.getElementById('saveGridBtn');
    closeGridEditorBtn = document.getElementById('closeGridEditorBtn');
    closeGridEditorHeader = document.getElementById('closeGridEditor');

    // 生成批量模式按钮
    buildModeButtons();
    // 生成地块选择按钮
    buildTileButtons();

    // 绑定所有事件监听器
    bindEditorEvents();

    // 颜色选择器处理
    const wallColorPicker = document.getElementById('wallColorPicker');

    if (wallColorPicker) {
        wallColorPicker.addEventListener('input', function (e) {
            if (!petGrid.customColors) petGrid.customColors = {};
            petGrid.customColors.wall = e.target.value;
            renderEditorGrid();
            updateTileButtonColors();
            if (typeof renderMainGrid === 'function') renderMainGrid();
        });
    }

    // 每个房间独立的地板颜色选择器
    const roomTypes = ['living', 'bedroom', 'kitchen', 'bathroom', 'laundry'];
    for (const roomType of roomTypes) {
        const picker = document.getElementById('floorColor_' + roomType);
        if (picker) {
            picker.addEventListener('input', function (e) {
                if (!petGrid.customColors) petGrid.customColors = {};
                if (!petGrid.customColors.floor) petGrid.customColors.floor = {};
                petGrid.customColors.floor[roomType] = e.target.value;
                renderEditorGrid();
                updateTileButtonColors();
                if (typeof renderMainGrid === 'function') renderMainGrid();
            });
        }
    }

    // 墙类型选择器
    const wallTypeSelect = document.getElementById('wallTypeSelect');
    if (wallTypeSelect) {
        wallTypeSelect.addEventListener('change', function (e) {
            editorWallType = e.target.value;
        });
    }

    // 初始化按钮颜色
    updateTileButtonColors();

    // 将已保存的颜色同步到选择器
    syncColorPickers();
}

// 将 petGrid.customColors 中的值同步到颜色选择器
function syncColorPickers() {
    if (!petGrid || !petGrid.customColors) return;

    const wallPicker = document.getElementById('wallColorPicker');
    if (wallPicker && petGrid.customColors.wall) {
        wallPicker.value = petGrid.customColors.wall;
    }

    const roomTypes = ['living', 'bedroom', 'kitchen', 'bathroom', 'laundry'];
    for (const roomType of roomTypes) {
        const picker = document.getElementById('floorColor_' + roomType);
        if (picker && petGrid.customColors.floor && petGrid.customColors.floor[roomType]) {
            picker.value = petGrid.customColors.floor[roomType];
        }
    }
}


// ============================================================
// 生成批量编辑模式按钮
// 在 #gridEditorModeToolbar 中生成：点、线、面三种模式
// ============================================================
function buildModeButtons() {
    if (!gridEditorModeToolbar) return;
    gridEditorModeToolbar.innerHTML = '';

    const modes = [
        { id: 'point', emoji: '🔹', label: '单格' },
        { id: 'line', emoji: '📏', label: '画线' },
        { id: 'rect', emoji: '⬜', label: '画面' }
    ];

    for (const mode of modes) {
        const btn = createTileButton(mode.emoji, mode.label, '#f0f0f0');
        btn.dataset.mode = mode.id;
        btn.addEventListener('click', function () {
            setDrawMode(mode.id, btn);
        });
        if (mode.id === editorDrawMode) {
            btn.classList.add('active');
        }
        gridEditorModeToolbar.appendChild(btn);
    }
}

// 更新工具栏中所有按钮的颜色（当颜色选择器变化时调用）
function updateTileButtonColors() {
    if (!gridEditorToolbar || !petGrid) return;

    // 更新每个房间地板按钮的背景色
    const floorBtns = gridEditorToolbar.querySelectorAll('.tile-btn[data-category="floor"]');
    floorBtns.forEach(function (btn) {
        const room = btn.dataset.room;
        if (room && ROOM_TYPES[room]) {
            const roomColors = (petGrid.customColors && petGrid.customColors.floor) || {};
            const color = roomColors[room] || ROOM_TYPES[room].defaultColor || ROOM_TYPES[room].color;
            btn.style.background = color;
        }
    });

    // 更新墙按钮
    const wallBtns = gridEditorToolbar.querySelectorAll('.tile-btn[data-category="wall"]');
    wallBtns.forEach(function (btn) {
        const wallColor = (petGrid.customColors && petGrid.customColors.wall) || '#3e2723';
        btn.style.background = wallColor;
        const emojiEl = btn.querySelector('.tile-emoji');
        if (emojiEl) {
            emojiEl.textContent = editorWallType === 'double' ? '🧱🧱' : '🧱';
        }
        const label = btn.querySelector('.tile-label');
        if (label) {
            label.textContent = editorWallType === 'double' ? '两格高墙' : '墙壁';
        }
    });
}

function setDrawMode(mode, btnElement) {
    editorDrawMode = mode;
    if (gridEditorModeToolbar) {
        const allBtns = gridEditorModeToolbar.querySelectorAll('.tile-btn');
        allBtns.forEach(function (b) { b.classList.remove('active'); });
    }
    if (btnElement) btnElement.classList.add('active');
}

// ============================================================
// 生成地块选择按钮
// 在 #gridEditorToolbar 中生成：5 种房间地板按钮、墙壁按钮、
// 所有家具类型按钮
// ============================================================
function buildTileButtons() {
    if (!gridEditorToolbar) return;
    gridEditorToolbar.innerHTML = '';

    // 1. 5 种房间地板按钮（客厅/卧室/厨房/卫生间/阳台）
    for (const roomKey in ROOM_TYPES) {
        if (!Object.prototype.hasOwnProperty.call(ROOM_TYPES, roomKey)) continue;
        const roomDef = ROOM_TYPES[roomKey];
        const btn = createTileButton(roomDef.emoji, roomDef.name, roomDef.color);
        btn.dataset.category = 'floor';
        btn.dataset.room = roomKey;
        btn.addEventListener('click', function () {
            selectTile({ category: 'floor', room: roomKey }, btn);
        });
        gridEditorToolbar.appendChild(btn);
    }

    // 2. 墙壁按钮（显示当前选择的墙类型）
    const wallBtn = createTileButton(
        editorWallType === 'double' ? '🧱🧱' : '🧱',
        editorWallType === 'double' ? '两格高墙' : '墙壁',
        '#3e2723'
    );
    wallBtn.dataset.category = 'wall';
    wallBtn.addEventListener('click', function () {
        selectTile({ category: 'wall', wallType: editorWallType }, wallBtn);
    });
    gridEditorToolbar.appendChild(wallBtn);

    // 3. 镜像按钮（放置家具时水平翻转）
    const mirrorBtn = createTileButton('↔️', '镜像', editorMirrorFurniture ? '#e3f2fd' : '#ffffff');
    mirrorBtn.dataset.category = 'mirror';
    if (editorMirrorFurniture) mirrorBtn.classList.add('active');
    mirrorBtn.addEventListener('click', function () {
        editorMirrorFurniture = !editorMirrorFurniture;
        const emojiEl = mirrorBtn.querySelector('.tile-emoji');
        if (emojiEl) emojiEl.textContent = editorMirrorFurniture ? '🔁' : '↔️';
        mirrorBtn.classList.toggle('active', editorMirrorFurniture);
        // 如果当前选中的是家具，同步 mirrored 状态
        if (editorSelectedTile && editorSelectedTile.category === 'furniture') {
            editorSelectedTile.mirrored = editorMirrorFurniture;
        }
    });
    gridEditorToolbar.appendChild(mirrorBtn);

    // 4. 所有家具类型按钮
    for (const furKey in FURNITURE_TYPES) {
        if (!Object.prototype.hasOwnProperty.call(FURNITURE_TYPES, furKey)) continue;
        const furDef = FURNITURE_TYPES[furKey];
        const btn = createTileButton(furDef.emoji, furDef.name, '#ffffff');
        btn.dataset.category = 'furniture';
        btn.dataset.type = furKey;
        // 如果有贴图，用贴图作为按钮图标
        if (furDef.image) {
            const img = document.createElement('img');
            img.src = imgPath(encodeURIComponent(furDef.image) + '.png');
            img.style.width = '20px';
            img.style.height = '20px';
            img.style.objectFit = 'contain';
            const emojiEl = btn.querySelector('.tile-emoji');
            if (emojiEl) {
                emojiEl.innerHTML = '';
                emojiEl.appendChild(img);
            }
        }
        btn.addEventListener('click', function () {
            selectTile({ category: 'furniture', type: furKey, mirrored: editorMirrorFurniture }, btn);
        });
        gridEditorToolbar.appendChild(btn);
    }
}

// 创建单个地块按钮
// emoji: 显示的 emoji 字符
// label: 按钮下方显示的名称
// bgColor: 按钮背景色（用于房间地板按钮显示房间颜色）
function createTileButton(emoji, label, bgColor) {
    const btn = document.createElement('div');
    btn.className = 'tile-btn';
    if (bgColor) {
        btn.style.background = bgColor;
    }
    const emojiSpan = document.createElement('span');
    emojiSpan.className = 'tile-emoji';
    emojiSpan.textContent = emoji;
    btn.appendChild(emojiSpan);
    const labelDiv = document.createElement('span');
    labelDiv.className = 'tile-label';
    labelDiv.textContent = label;
    btn.appendChild(labelDiv);
    return btn;
}

// 选中某个地块类型，更新状态和按钮高亮
function selectTile(tileObj, btnElement) {
    editorSelectedTile = tileObj;
    editorIsEraser = !!(tileObj && tileObj.category === 'eraser');
    // 清除所有按钮的 active 状态，再给当前按钮加上
    if (gridEditorToolbar) {
        const allBtns = gridEditorToolbar.querySelectorAll('.tile-btn');
        allBtns.forEach(function (b) { b.classList.remove('active'); });
    }
    if (btnElement) {
        btnElement.classList.add('active');
    }
}


// ============================================================
// 事件绑定
// ============================================================
function bindEditorEvents() {
    // 关闭按钮（底部）→ 关闭编辑器
    if (closeGridEditorBtn) {
        closeGridEditorBtn.addEventListener('click', closeGridEditor);
    }
    // 关闭按钮（头部）→ 关闭编辑器
    if (closeGridEditorHeader) {
        closeGridEditorHeader.addEventListener('click', closeGridEditor);
    }
    // 保存按钮 → 保存并刷新主界面
    if (saveGridBtn) {
        saveGridBtn.addEventListener('click', saveGridAndRefresh);
    }
    // 应用尺寸按钮 → 调整网格尺寸
    if (applyGridSizeBtn) {
        applyGridSizeBtn.addEventListener('click', applyGridSize);
    }
    // 重置默认按钮 → 恢复默认网格
    if (resetGridBtn) {
        resetGridBtn.addEventListener('click', resetGridToDefault);
    }

    // 全局 mouseup 结束拖拽
    document.addEventListener('mouseup', function () {
        editorIsDragging = false;
    });

    // 离开编辑器画布区域时也停止拖拽
    if (gridEditorCanvas) {
        gridEditorCanvas.addEventListener('mouseleave', function () {
            editorIsDragging = false;
        });
    }

    // 防止拖拽绘制时选中文字或触发拖拽行为
    if (gridCanvasInner) {
        gridCanvasInner.addEventListener('selectstart', function (e) {
            if (editorIsDragging) e.preventDefault();
        });
        gridCanvasInner.addEventListener('dragstart', function (e) {
            e.preventDefault();
        });
    }
}


// ============================================================
// 打开/关闭编辑器
// ============================================================

// 打开编辑器：显示覆盖层、同步尺寸输入框、渲染网格、更新验证提示
function openGridEditor() {
    if (!gridEditorOverlay) return;
    // 确保网格数据已加载
    if (!petGrid) {
        loadGrid();
    }
    gridEditorOverlay.classList.add('show');
    // 同步尺寸输入框为当前网格尺寸
    if (gridColsInput && petGrid) gridColsInput.value = petGrid.cols;
    if (gridRowsInput && petGrid) gridRowsInput.value = petGrid.rows;
    // 同步格子大小输入框（从 config 读取，0=自动）
    if (gridCellSizeInput) {
        gridCellSizeInput.value = (typeof config !== 'undefined' && config.gridCellSize !== undefined) ? config.gridCellSize : 0;
    }
    renderEditorGrid();
    updateFurnitureValidation();
}

// 关闭编辑器：隐藏覆盖层、保存网格、重新渲染主界面
function closeGridEditor() {
    if (!gridEditorOverlay) return;
    gridEditorOverlay.classList.remove('show');
    // 关闭时停止拖拽
    editorIsDragging = false;
    // 保存网格并重新渲染主界面
    saveGridAndRefresh();
}


// ============================================================
// 渲染编辑器网格（固定正方形，便于编辑）
// 清空画布、设置尺寸、为每个格子创建可编辑的 div 并绑定事件
// ============================================================
function renderEditorGrid() {
    if (!gridCanvasInner || !petGrid) return;
    gridCanvasInner.innerHTML = '';

    const cellSize = editorCellSize;  // 固定使用 30px
    const totalWidth = petGrid.cols * cellSize;
    const totalHeight = petGrid.rows * cellSize;
    gridCanvasInner.style.width = totalWidth + 'px';
    gridCanvasInner.style.height = totalHeight + 'px';

    // 遍历所有格子，创建可编辑的 div
    for (let r = 0; r < petGrid.rows; r++) {
        for (let c = 0; c < petGrid.cols; c++) {
            const cell = petGrid.cells[r][c];
            const cellDiv = document.createElement('div');
            cellDiv.className = 'grid-cell-editable';
            cellDiv.style.left = (c * cellSize) + 'px';
            cellDiv.style.top = (r * cellSize) + 'px';
            cellDiv.style.width = cellSize + 'px';
            cellDiv.style.height = cellSize + 'px';
            cellDiv.dataset.col = c;
            cellDiv.dataset.row = r;

            // 根据格子类型设置显示
            applyCellDisplayStyle(cellDiv, cell, cellSize);

            // 绑定编辑事件（使用闭包捕获当前 c/r）
            (function (col, row) {
                cellDiv.addEventListener('mousedown', function (e) {
                    e.preventDefault();
                    editorIsDragging = true;
                    editorDragStartCol = col;
                    editorDragStartRow = row;
                    if (editorDrawMode === 'point') {
                        editCellAt(col, row);
                    } else {
                        // 线/面模式：先记录起点，实时预览在 mouseenter 中处理
                        editCellsInMode(editorDragStartCol, editorDragStartRow, col, row);
                    }
                });
                cellDiv.addEventListener('mouseenter', function () {
                    if (editorIsDragging) {
                        if (editorDrawMode === 'point') {
                            editCellAt(col, row);
                        } else {
                            editCellsInMode(editorDragStartCol, editorDragStartRow, col, row);
                        }
                    }
                });
            })(c, r);

            gridCanvasInner.appendChild(cellDiv);
        }
    }
}

// 根据格子数据设置 div 的显示样式（背景色、家具 emoji）
function applyCellDisplayStyle(cellDiv, cell, cellSize) {
    cellDiv.textContent = '';
    cellDiv.style.fontSize = '';
    cellDiv.style.lineHeight = '';

    if (cell.type === 'wall') {
        const wallColor = (petGrid && petGrid.customColors && petGrid.customColors.wall) || '#3e2723';
        cellDiv.style.background = wallColor;
        // 两格高墙显示特殊标记
        if (cell.wallType === 'double') {
            cellDiv.textContent = '🧱';
            cellDiv.style.fontSize = (cellSize * 0.8) + 'px';
            cellDiv.style.lineHeight = '1';
        }
    } else {
        const roomColors = (petGrid && petGrid.customColors && petGrid.customColors.floor) || {};
        if (cell.room && ROOM_TYPES[cell.room]) {
            cellDiv.style.background = roomColors[cell.room] || ROOM_TYPES[cell.room].defaultColor || ROOM_TYPES[cell.room].color;
        } else {
            cellDiv.style.background = roomColors['default'] || '#f5f5f5';
        }
        if (cell.furniture) {
            const furDef = FURNITURE_TYPES[cell.furniture.type];
            if (furDef && furDef.image) {
                const img = document.createElement('img');
                img.src = imgPath(encodeURIComponent(furDef.image) + '.png');
                img.style.width = (cellSize * 0.8) + 'px';
                img.style.height = (cellSize * 0.8) + 'px';
                img.style.objectFit = 'contain';
                img.style.position = 'absolute';
                img.style.left = '50%';
                img.style.top = '50%';
                img.style.pointerEvents = 'none';
                let transform = 'translate(-50%, -50%)';
                if (cell.furniture.mirrored) transform += ' scaleX(-1)';
                img.style.transform = transform;
                cellDiv.appendChild(img);
            } else {
                cellDiv.textContent = furDef ? furDef.emoji : '❓';
                cellDiv.style.fontSize = (cellSize * 0.7) + 'px';
                cellDiv.style.lineHeight = '1';
            }
        }
    }
}


// ============================================================
// 格子点击/拖拽编辑
// 根据当前选中的地块类型修改格子内容
// ============================================================
function editCellAt(col, row) {
    if (!petGrid) return;
    const cell = getGridCell(col, row);
    if (!cell) return;

    if (!editorSelectedTile) return;

    if (editorSelectedTile.category === 'floor') {
        setGridCell(col, row, 'floor', editorSelectedTile.room, null);
    } else if (editorSelectedTile.category === 'wall') {
        setGridCell(col, row, 'wall', null, null, editorSelectedTile.wallType || 'normal');
    } else if (editorSelectedTile.category === 'furniture') {
        placeFurnitureInCell(col, row, editorSelectedTile.type, editorSelectedTile.mirrored);
    } else {
        return;
    }

    // 更新单个格子的显示（避免重新渲染整个网格）
    updateCellDisplay(col, row);
    // 更新验证提示
    updateFurnitureValidation();
}

// 批量编辑：根据模式（线/面）填充多个格子
function editCellsInMode(startCol, startRow, endCol, endRow) {
    if (!petGrid || !editorSelectedTile) return;

    const cellsToEdit = [];

    if (editorDrawMode === 'line') {
        // Bresenham 直线算法
        cellsToEdit.push(...getLineCells(startCol, startRow, endCol, endRow));
    } else if (editorDrawMode === 'rect') {
        // 矩形填充
        const minCol = Math.min(startCol, endCol);
        const maxCol = Math.max(startCol, endCol);
        const minRow = Math.min(startRow, endRow);
        const maxRow = Math.max(startRow, endRow);
        for (let r = minRow; r <= maxRow; r++) {
            for (let c = minCol; c <= maxCol; c++) {
                cellsToEdit.push({ col: c, row: r });
            }
        }
    }

    for (const pos of cellsToEdit) {
        const cell = getGridCell(pos.col, pos.row);
        if (!cell) continue;
        if (editorSelectedTile.category === 'floor') {
            setGridCell(pos.col, pos.row, 'floor', editorSelectedTile.room, null);
        } else if (editorSelectedTile.category === 'wall') {
            setGridCell(pos.col, pos.row, 'wall', null, null, editorSelectedTile.wallType || 'normal');
        } else if (editorSelectedTile.category === 'furniture') {
            placeFurnitureInCell(pos.col, pos.row, editorSelectedTile.type, editorSelectedTile.mirrored);
        }
        updateCellDisplay(pos.col, pos.row);
    }
    updateFurnitureValidation();
}

// Bresenham 直线算法：返回从 (x0,y0) 到 (x1,y1) 经过的所有格子坐标
function getLineCells(x0, y0, x1, y1) {
    const result = [];
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;

    while (true) {
        result.push({ col: x0, row: y0 });
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 > -dy) {
            err -= dy;
            x0 += sx;
        }
        if (e2 < dx) {
            err += dx;
            y0 += sy;
        }
    }
    return result;
}

// 在指定格子放置家具
// 如果格子不是地板，先改为地板并设置家具所属房间；
// 如果家具的 room 为 null（如 plant, lamp），则保持当前 room 不变
function placeFurnitureInCell(col, row, furnitureType, mirrored) {
    const def = FURNITURE_TYPES[furnitureType];
    if (!def) return;
    const cell = getGridCell(col, row);
    if (!cell) return;

    // 如果格子的 type 不是 floor，先将其改为 floor 并设置家具所属的 room
    if (cell.type !== 'floor') {
        cell.type = 'floor';
        // 家具的 room 不为 null 时设置房间；为 null 时保持当前 room 不变
        if (def.room !== null) {
            cell.room = def.room;
        }
    }
    // 放置家具
    cell.furniture = { type: furnitureType, mirrored: !!mirrored };
}

// 更新单个格子的显示（避免重新渲染整个网格）
function updateCellDisplay(col, row) {
    if (!gridCanvasInner) return;
    const cellDiv = gridCanvasInner.querySelector(
        '.grid-cell-editable[data-col="' + col + '"][data-row="' + row + '"]'
    );
    if (!cellDiv) return;
    const cell = getGridCell(col, row);
    if (!cell) return;
    applyCellDisplayStyle(cellDiv, cell, editorCellSize);
}


// ============================================================
// 网格尺寸调整
// 读取输入框的列数和行数，验证范围（5-40 列，5-30 行），
// 保留原有内容（超出范围的丢弃，新增的格子填充为墙）
// 同时读取格子大小设置并写入 config，立即应用到主界面
// ============================================================
function applyGridSize() {
    if (!gridColsInput || !gridRowsInput || !petGrid) return;

    let newCols = parseInt(gridColsInput.value, 10);
    let newRows = parseInt(gridRowsInput.value, 10);

    // 验证范围：列数 5-40，行数 5-30
    if (isNaN(newCols) || newCols < 5 || newCols > 40) {
        newCols = Math.max(5, Math.min(40, isNaN(newCols) ? GRID_COLS : newCols));
        gridColsInput.value = newCols;
    }
    if (isNaN(newRows) || newRows < 5 || newRows > 30) {
        newRows = Math.max(5, Math.min(30, isNaN(newRows) ? GRID_ROWS : newRows));
        gridRowsInput.value = newRows;
    }

    // 读取格子大小设置（0=自动，>0=指定像素）
    let newCellSize = 0;
    if (gridCellSizeInput) {
        newCellSize = parseInt(gridCellSizeInput.value, 10);
        if (isNaN(newCellSize) || newCellSize < 0) newCellSize = 0;
        if (newCellSize > 80) newCellSize = 80;
        gridCellSizeInput.value = newCellSize;
    }
    // 写入 config 并保存
    if (typeof config !== 'undefined') {
        config.gridCellSize = newCellSize;
        if (typeof saveConfig === 'function') {
            saveConfig();
        } else {
            try { localStorage.setItem('petConfig', JSON.stringify(config)); } catch (e) {}
        }
    }

    // 尺寸未变化则只刷新主界面（格子大小可能变化）
    if (newCols === petGrid.cols && newRows === petGrid.rows) {
        if (typeof renderMainGrid === 'function') renderMainGrid();
        return;
    }

    // 创建新网格，保留原有内容
    const oldCells = petGrid.cells;
    const oldCols = petGrid.cols;
    const oldRows = petGrid.rows;
    const newCells = [];
    for (let r = 0; r < newRows; r++) {
        newCells[r] = [];
        for (let c = 0; c < newCols; c++) {
            if (r < oldRows && c < oldCols) {
                // 保留旧格子内容（深拷贝以避免引用问题）
                const oldCell = oldCells[r][c];
                newCells[r][c] = {
                    type: oldCell.type,
                    room: oldCell.room,
                    furniture: oldCell.furniture
                        ? { type: oldCell.furniture.type, mirrored: oldCell.furniture.mirrored }
                        : null,
                    wallType: oldCell.wallType || null
                };
            } else {
                newCells[r][c] = { type: 'wall', room: null, furniture: null, wallType: null };
            }
        }
    }

    // 更新 petGrid
    petGrid.cols = newCols;
    petGrid.rows = newRows;
    petGrid.cells = newCells;

    // 重新渲染编辑器网格
    renderEditorGrid();
    updateFurnitureValidation();
    // 立即刷新主界面网格（应用新的格子大小）
    if (typeof renderMainGrid === 'function') renderMainGrid();
    // 保存到 localStorage
    if (typeof saveGrid === 'function') saveGrid();
}


// ============================================================
// 重置默认
// 调用 createDefaultGrid()，更新 petGrid、输入框、重新渲染
// 同时重置格子大小为 0（自动）
// ============================================================
function resetGridToDefault() {
    const defaultGrid = createDefaultGrid();
    petGrid.cols = defaultGrid.cols;
    petGrid.rows = defaultGrid.rows;
    petGrid.cells = defaultGrid.cells;
    petGrid.customColors = defaultGrid.customColors;

    // 更新输入框值
    if (gridColsInput) gridColsInput.value = petGrid.cols;
    if (gridRowsInput) gridRowsInput.value = petGrid.rows;
    // 重置格子大小为 0（自动）
    if (gridCellSizeInput) gridCellSizeInput.value = 0;
    if (typeof config !== 'undefined') {
        config.gridCellSize = 0;
        if (typeof saveConfig === 'function') {
            saveConfig();
        } else {
            try { localStorage.setItem('petConfig', JSON.stringify(config)); } catch (e) {}
        }
    }

    // 重新渲染编辑器网格
    renderEditorGrid();
    updateFurnitureValidation();
    if (typeof renderMainGrid === 'function') renderMainGrid();
    // 保存到 localStorage
    if (typeof saveGrid === 'function') saveGrid();
}

// ============================================================
// 保存
// 调用 saveGrid() 保存到 localStorage，并重新渲染主界面网格
// ============================================================
function saveGridAndRefresh() {
    saveGrid();
    renderMainGrid();
    // 保存后将桌宠移到客厅的一个地板格子上
    if (typeof getRandomRoomCell === 'function' && typeof updatePetPosition === 'function') {
        const livingCell = getRandomRoomCell('living');
        if (livingCell && typeof gridCellSize !== 'undefined' && typeof gridOffsetX !== 'undefined') {
            const petEl = document.getElementById('pet');
            const petWidth = petEl ? petEl.offsetWidth : 55;
            const petHeight = petEl ? petEl.offsetHeight : 55;
            const viewMode = (typeof config !== 'undefined') ? config.gridViewMode : 'diamond';
            const pos = gridToScreen(livingCell.col, livingCell.row, gridCellSize, gridOffsetX, gridOffsetY, viewMode);
            const newX = pos.x - petWidth / 2;
            const newY = pos.y - petHeight / 2;
            if (typeof petX !== 'undefined') petX = newX;
            if (typeof petY !== 'undefined') petY = newY;
            updatePetPosition();
            if (typeof isMoving !== 'undefined') isMoving = false;
            if (typeof currentPath !== 'undefined') currentPath = [];
            if (typeof updateCurrentRoom === 'function') updateCurrentRoom();
        }
    }
}

// 重新渲染主界面网格
// 委托给 index.js 的 updateGridLayout（已使用 config.gridCellSize），
// 确保寻路/碰撞检测使用的 gridCellSize/gridOffsetX/gridOffsetY 同步更新
function renderMainGrid() {
    if (typeof updateGridLayout === 'function') {
        // 网格数据已被编辑（家具/房间/墙面变化），强制失效布局缓存，
        // 否则 updateGridLayout 会因 cellSize/offsets 不变而跳过 renderGrid
        if (typeof lastGridLayout !== 'undefined') lastGridLayout = null;
        updateGridLayout();
        return;
    }
    // 兜底：直接渲染（极少走到此分支）
    const houseEl = document.getElementById('house');
    if (!houseEl || !petGrid) return;
    const houseRect = houseEl.getBoundingClientRect();
    const customCellSize = (typeof config !== 'undefined' && config.gridCellSize !== undefined) ? config.gridCellSize : 0;
    const viewMode = (typeof config !== 'undefined') ? config.gridViewMode : 'diamond';
    const layout = calculateGridLayout(
        { width: houseRect.width, height: houseRect.height },
        petGrid.cols,
        petGrid.rows,
        customCellSize,
        viewMode
    );
    renderGrid(houseEl, layout.offsetX, layout.offsetY, layout.cellSize, viewMode);
}


// ============================================================
// 验证提示更新
// 调用 checkRequiredFurniture()，根据缺失情况显示绿色或黄色提示
// ============================================================
function updateFurnitureValidation() {
    if (!furnitureValidation) return;
    const missing = checkRequiredFurniture();
    if (missing.length === 0) {
        // 全部满足：绿色提示
        furnitureValidation.textContent = '✅ 必要家具已齐全';
        furnitureValidation.className = 'furniture-validation ok';
    } else {
        // 有缺失：黄色提示，列出缺失的家具名称
        const missingNames = missing.map(function (ft) {
            return FURNITURE_TYPES[ft] ? FURNITURE_TYPES[ft].name : ft;
        });
        furnitureValidation.textContent = '⚠️ 缺少必要家具：' + missingNames.join('、');
        furnitureValidation.className = 'furniture-validation warning';
    }
}


// ============================================================
// 页面加载时初始化编辑器
// ============================================================
window.addEventListener('load', function () {
    initGridEditor();
});
