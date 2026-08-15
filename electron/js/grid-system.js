// ============================================================
// 网格化地图系统 - 桌宠项目
// 将原本基于 HTML div 的房间/墙壁/家具布局改为网格化数据模型
// 每个格子可独立编辑为：墙、地板（区分房间类型）、家具
// ============================================================

// ===== 房间类型定义 =====
// 每种房间对应一种颜色和标识 emoji
const ROOM_TYPES = {
    living: { name: '客厅', color: '#fce4ec', emoji: '🛋️', defaultColor: '#fce4ec' },
    bedroom: { name: '卧室', color: '#f3e5f5', emoji: '🛏️', defaultColor: '#f3e5f5' },
    kitchen: { name: '厨房', color: '#fff8e1', emoji: '🍳', defaultColor: '#fff8e1' },
    bathroom: { name: '卫生间', color: '#e3f2fd', emoji: '🚿', defaultColor: '#e3f2fd' },
    laundry: { name: '阳台', color: '#e8f5e9', emoji: '🧺', defaultColor: '#e8f5e9' }
};

// ===== 家具类型定义 =====
// room: 该家具所属的房间类型（null 表示任意房间均可放置）
// required: 是否为必要家具（开局必须放置）
// action: 该家具对应的行为类型（null 表示无交互行为）
const FURNITURE_TYPES = {
    bed: { emoji: '🛏️', image: '床', name: '床', room: 'bedroom', required: true, action: 'sleep' },
    stove: { emoji: '🍳', image: '灶台', name: '灶台', room: 'kitchen', required: true, action: 'eat' },
    fridge: { emoji: '🧊', image: '冰箱', name: '冰箱', room: 'kitchen', required: false, action: 'eat' },
    sink: { emoji: '🚰', image: '水槽', name: '水槽', room: 'kitchen', required: false, action: null },
    toilet: { emoji: '🚽', image: '马桶', name: '马桶', room: 'bathroom', required: true, action: 'toilet' },
    shower: { emoji: '🚿', image: '浴室', name: '淋浴', room: 'bathroom', required: true, action: 'bathe' },
    tv: { emoji: '📺', image: '电视', name: '电视', room: 'living', required: false, action: 'watch_tv' },
    sofa: { emoji: '🛋️', image: '沙发', name: '沙发', room: 'living', required: false, action: null },
    table: { emoji: '☕', image: '餐桌', name: '餐桌', room: 'living', required: false, action: null },
    wardrobe: { emoji: '🚪', image: '衣柜', name: '衣柜', room: 'bedroom', required: false, action: null },
    washer: { emoji: '🫧', image: '洗衣机', name: '洗衣机', room: 'laundry', required: false, action: null },
    plant: { emoji: '🪴', image: null, name: '植物', room: null, required: false, action: null },
    lamp: { emoji: '💡', image: null, name: '灯', room: null, required: false, action: null }
};

// 必要家具列表（开局必须放置）
const REQUIRED_FURNITURE = ['bed', 'stove', 'toilet', 'shower'];

// ===== 贴图缩放倍数表 =====
// 在家具基础 imgScale 之上额外乘以该倍数。
// 键为家具类型（基础贴图，如 'sofa' → 沙发.png）或 "类型_变体"（变体贴图，如 'sofa_坐' → 沙发_坐.png）。
// 未列出的默认为 1（不额外缩放）。
const TEXTURE_SCALE = {
    sofa: 1.2,          // 沙发.png
    'sofa_坐': 1.5,     // 沙发_坐.png
    bed: 1.3,           // 床.png
    'bed_睡觉': 1.3,    // 床_睡觉.png
    'table_吃饭': 1.3   // 餐桌_吃饭.png
};

// 家具基础 imgScale（与 renderGrid 中默认规则保持一致）
function getFurnitureBaseImgScale(type) {
    if (type === 'wardrobe') return 3;
    if (type === 'stove' || type === 'shower') return 4;
    return 2;
}

// 取得贴图缩放倍数（TEXTURE_SCALE 中查找，默认 1）
function getTextureScale(key) {
    return TEXTURE_SCALE[key] || 1;
}

// 计算家具最终缩放：基础 imgScale × 贴图倍数
// variantSuffix 为 null/空 时取基础贴图倍数，否则取 "类型_变体" 倍数
function getFurnitureFinalScale(type, variantSuffix) {
    const key = variantSuffix ? (type + '_' + variantSuffix) : type;
    return getFurnitureBaseImgScale(type) * getTextureScale(key);
}

// 更新家具 img 的缩放（保留原有的水平镜像）
function setCellImgScale(img, scale) {
    if (!img) return;
    const mirrored = (img.style.transform || '').indexOf('scaleX(-1)') >= 0;
    let transform = 'translate(-50%, -50%) scale(' + scale + ')';
    if (mirrored) transform += ' scaleX(-1)';
    img.style.transform = transform;
}

// ===== 网格常量 =====
const GRID_COLS = 20;          // 默认列数
const GRID_ROWS = 15;          // 默认行数
const GRID_STORAGE_KEY = 'petGrid';  // localStorage 键名

// 全局网格数据对象
// 结构: { cols, rows, cells[row][col] }
// 每个 cell: { type: 'floor'|'wall', room: 房间类型|null, furniture: null|{type, mirrored} }
let petGrid = null;


// ============================================================
// 网格数据模型与默认布局
// ============================================================

// 创建一个格子对象
function createCell(type, room, furniture) {
    return {
        type: type || 'floor',
        room: room || null,
        furniture: furniture || null,
        wallType: null  // null=普通墙, 'double'=两格高墙
    };
}

// 在 cells 二维数组中填充矩形区域为指定房间类型的地板
function fillRoom(cells, colStart, rowStart, colEnd, rowEnd, roomType) {
    for (let r = rowStart; r <= rowEnd; r++) {
        if (r < 0 || r >= cells.length) continue;
        for (let c = colStart; c <= colEnd; c++) {
            if (c < 0 || c >= cells[r].length) continue;
            cells[r][c] = createCell('floor', roomType, null);
        }
    }
}

// 在指定格子放置家具
// mirrored: 是否水平镜像（默认 false）
function placeFurniture(cells, col, row, furnitureType, mirrored) {
    if (row < 0 || row >= cells.length) return;
    if (col < 0 || col >= cells[row].length) return;
    const def = FURNITURE_TYPES[furnitureType];
    if (!def) return;
    cells[row][col].furniture = { type: furnitureType, mirrored: !!mirrored };
}

// 创建默认网格布局
// 基于 index.css 中的房间百分比位置转换为 20x15 网格：
//   厨房   kitchen:  top 10%, left 5%,  width 26%, height 26%  → cols 1-5,  rows 1-4
//   卫生间 bathroom: top 10%, left 33%, width 22%, height 26%  → cols 7-10, rows 1-4
//   阳台   laundry:  top 10%, left 57%, width 38%, height 26%  → cols 12-18, rows 1-4
//   客厅   living:   top 38%, left 5%,  width 56%, height 54%  → cols 1-11, rows 6-13
//   卧室   bedroom:  top 38%, left 63%, width 32%, height 54%  → cols 13-18, rows 6-13
function createDefaultGrid() {
    const cols = GRID_COLS;
    const rows = GRID_ROWS;
    const cells = [];

    // 1. 初始化所有格子为墙
    for (let r = 0; r < rows; r++) {
        cells[r] = [];
        for (let c = 0; c < cols; c++) {
            cells[r][c] = createCell('wall', null, null);
        }
    }

    // 2. 设置五个房间的地板区域
    fillRoom(cells, 1, 1, 5, 4, 'kitchen');     // 厨房
    fillRoom(cells, 7, 1, 10, 4, 'bathroom');   // 卫生间
    fillRoom(cells, 12, 1, 18, 4, 'laundry');   // 阳台
    fillRoom(cells, 1, 6, 11, 13, 'living');    // 客厅
    fillRoom(cells, 13, 6, 18, 13, 'bedroom');  // 卧室

    // 3. 设置门（在墙壁上开门，门本身是地板格子，保证房间连通）
    // 卫生间 ↔ 阳台: (11,2) (11,3) —— 归属卫生间
    cells[2][11] = createCell('floor', 'bathroom', null);
    cells[3][11] = createCell('floor', 'bathroom', null);
    // 厨房 ↔ 客厅: (3,5) (4,5) —— 归属客厅
    cells[5][3] = createCell('floor', 'living', null);
    cells[5][4] = createCell('floor', 'living', null);
    // 卫生间 ↔ 客厅: (8,5) —— 归属客厅
    cells[5][8] = createCell('floor', 'living', null);
    // 阳台 ↔ 卧室: (15,5) —— 归属卧室
    cells[5][15] = createCell('floor', 'bedroom', null);
    // 客厅 ↔ 卧室: (12,9) (12,10) —— 归属客厅
    cells[9][12] = createCell('floor', 'living', null);
    cells[10][12] = createCell('floor', 'living', null);

    // 4. 放置家具
    // 厨房家具
    placeFurniture(cells, 1, 1, 'sink');      // 水槽 左上角
    placeFurniture(cells, 4, 1, 'fridge');    // 冰箱 右上角
    placeFurniture(cells, 2, 2, 'stove');     // 灶台 中部偏左

    // 卫生间家具
    placeFurniture(cells, 7, 1, 'shower');    // 淋浴 左上角
    placeFurniture(cells, 9, 1, 'toilet');    // 马桶 右上角

    // 阳台家具
    placeFurniture(cells, 12, 1, 'plant');    // 植物 左上角
    placeFurniture(cells, 16, 1, 'washer');   // 洗衣机 右上角

    // 客厅家具
    placeFurniture(cells, 10, 6, 'tv');       // 电视 右上角
    placeFurniture(cells, 5, 9, 'table');     // 餐桌 中部
    placeFurniture(cells, 5, 12, 'sofa');     // 沙发 下方中部

    // 卧室家具
    placeFurniture(cells, 13, 6, 'wardrobe'); // 衣柜 左上角
    placeFurniture(cells, 17, 6, 'lamp');     // 灯 右上角
    placeFurniture(cells, 15, 9, 'bed');      // 床 中部

    return {
        cols,
        rows,
        cells,
        customColors: {
            wall: '#3e2723',
            floor: {
                living: ROOM_TYPES.living.defaultColor,
                bedroom: ROOM_TYPES.bedroom.defaultColor,
                kitchen: ROOM_TYPES.kitchen.defaultColor,
                bathroom: ROOM_TYPES.bathroom.defaultColor,
                laundry: ROOM_TYPES.laundry.defaultColor
            }
        }
    };
}


// ============================================================
// 网格管理函数
// ============================================================

// 从 localStorage 加载网格，不存在则创建默认网格
function loadGrid() {
    const saved = localStorage.getItem(GRID_STORAGE_KEY);
    if (saved) {
        try {
            const data = JSON.parse(saved);
            if (data &&
                typeof data.cols === 'number' &&
                typeof data.rows === 'number' &&
                Array.isArray(data.cells) &&
                data.cells.length === data.rows) {
                // 迁移：旧版本 customColors.floor 为字符串（覆盖所有地板），已废弃
                // 改用各房间默认色，以便区分房间
                if (data.customColors && typeof data.customColors.floor === 'string') {
                    data.customColors.floor = {};
                }
                // 迁移：确保 customColors.floor 对象包含所有房间类型
                if (!data.customColors) data.customColors = {};
                if (!data.customColors.floor || typeof data.customColors.floor !== 'object') {
                    data.customColors.floor = {};
                }
                for (const roomKey of Object.keys(ROOM_TYPES)) {
                    if (!data.customColors.floor[roomKey]) {
                        data.customColors.floor[roomKey] = ROOM_TYPES[roomKey].defaultColor;
                    }
                }
                // 迁移：检测旧版"所有房间同色"（由旧覆盖逻辑产生），重置为默认色
                const fc = data.customColors.floor;
                const roomKeys = Object.keys(ROOM_TYPES);
                if (roomKeys.length > 1 && fc[roomKeys[0]]) {
                    const firstColor = fc[roomKeys[0]];
                    let allSame = true;
                    for (let i = 1; i < roomKeys.length; i++) {
                        if (fc[roomKeys[i]] !== firstColor) { allSame = false; break; }
                    }
                    if (allSame) {
                        for (const rk of roomKeys) {
                            fc[rk] = ROOM_TYPES[rk].defaultColor;
                        }
                    }
                }
                // 迁移：确保每个 cell 都有 wallType 属性
                for (let r = 0; r < data.rows; r++) {
                    for (let c = 0; c < data.cols; c++) {
                        if (data.cells[r][c] && data.cells[r][c].wallType === undefined) {
                            data.cells[r][c].wallType = null;
                        }
                    }
                }
                // 迁移：旧版 furniture 格式 {type, emoji} → 新版 {type, mirrored}
                for (let r = 0; r < data.rows; r++) {
                    for (let c = 0; c < data.cols; c++) {
                        const cell = data.cells[r][c];
                        if (cell && cell.furniture) {
                            if (cell.furniture.mirrored === undefined) {
                                cell.furniture.mirrored = false;
                            }
                            if (cell.furniture.emoji !== undefined) {
                                delete cell.furniture.emoji;
                            }
                        }
                    }
                }
                petGrid = data;
                return petGrid;
            }
            console.warn('[Grid] loadGrid: 数据验证失败，使用默认网格');
        } catch (e) {
            console.error('[Grid] loadGrid: 解析/迁移失败:', e.message || e);
        }
    }
    petGrid = createDefaultGrid();
    saveGrid();
    return petGrid;
}

// 保存网格到 localStorage
function saveGrid() {
    if (!petGrid) {
        console.warn('[Grid] saveGrid: petGrid 为空，跳过保存');
        return;
    }
    try {
        const json = JSON.stringify(petGrid);
        localStorage.setItem(GRID_STORAGE_KEY, json);
    } catch (e) {
        console.error('[Grid] saveGrid: 保存失败:', e.message || e);
    }
}

// 获取指定格子（越界返回 null）
function getGridCell(col, row) {
    if (!petGrid) return null;
    if (row < 0 || row >= petGrid.rows) return null;
    if (col < 0 || col >= petGrid.cols) return null;
    return petGrid.cells[row][col];
}

// 设置指定格子的属性
function setGridCell(col, row, type, room, furniture, wallType) {
    if (!petGrid) return;
    const cell = getGridCell(col, row);
    if (!cell) return;
    cell.type = type;
    cell.room = room;
    cell.furniture = furniture;
    if (type === 'wall') {
        cell.wallType = wallType || null;
    } else {
        cell.wallType = null;
    }
}

// 判断格子是否可通行（非墙且无家具即通行）
// 沙发、床、餐桌的九宫格范围也不可通行（但鼠标放置不受限制）
// 当 furniturePathMode 为 true 时，忽略家具九宫格限制（用于前往家具时）
let furniturePathMode = false;
function isCellWalkable(col, row) {
    const cell = getGridCell(col, row);
    if (!cell) return false;
    if (cell.type === 'wall') return false;
    if (cell.furniture) return false;
    if (!furniturePathMode) {
        // 检查九宫格范围内是否有沙发、床、餐桌
        const blockedTypes = ['sofa', 'bed', 'table'];
        for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
                const nc = col + dc;
                const nr = row + dr;
                const nearCell = getGridCell(nc, nr);
                if (nearCell && nearCell.furniture && blockedTypes.indexOf(nearCell.furniture.type) >= 0) {
                    return false;
                }
            }
        }
    }
    return true;
}

// 设置家具寻路模式（true时忽略家具九宫格阻挡）
function setFurniturePathMode(enabled) {
    furniturePathMode = !!enabled;
}

// 查找指定类型家具的所有格子
// 返回: [{ col, row, cell }, ...]
function findFurnitureCells(furnitureType) {
    const result = [];
    if (!petGrid) return result;
    for (let r = 0; r < petGrid.rows; r++) {
        for (let c = 0; c < petGrid.cols; c++) {
            const cell = petGrid.cells[r][c];
            if (cell.furniture && cell.furniture.type === furnitureType) {
                result.push({ col: c, row: r, cell: cell });
            }
        }
    }
    return result;
}

// 查找指定房间内所有家具格子
// 返回: [{ col, row, cell }, ...]
function findFurnitureCellsByRoom(roomType) {
    const result = [];
    if (!petGrid) return result;
    for (let r = 0; r < petGrid.rows; r++) {
        for (let c = 0; c < petGrid.cols; c++) {
            const cell = petGrid.cells[r][c];
            if (cell.furniture && cell.room === roomType) {
                result.push({ col: c, row: r, cell: cell });
            }
        }
    }
    return result;
}

// 获取指定房间类型的所有地板格子
// 返回: [{ col, row, cell }, ...]
function getRoomCells(roomType) {
    const result = [];
    if (!petGrid) return result;
    for (let r = 0; r < petGrid.rows; r++) {
        for (let c = 0; c < petGrid.cols; c++) {
            const cell = petGrid.cells[r][c];
            if (cell.type === 'floor' && cell.room === roomType) {
                result.push({ col: c, row: r, cell: cell });
            }
        }
    }
    return result;
}

// 随机获取指定房间的一个地板格子
// 返回: { col, row, cell } 或 null
function getRandomRoomCell(roomType) {
    const cells = getRoomCells(roomType);
    if (cells.length === 0) return null;
    return cells[Math.floor(Math.random() * cells.length)];
}

// 查找指定类型家具相邻的可通行格子（用于看电视等行为）
// 相邻指上下左右四方向，去重后返回
// 返回: [{ col, row, cell }, ...]
function findFurnitureAdjacentCells(furnitureType) {
    const result = [];
    const furnitureCells = findFurnitureCells(furnitureType);
    if (furnitureCells.length === 0) return result;

    const directions = [
        { dc: 0, dr: -1 },  // 上
        { dc: 0, dr: 1 },   // 下
        { dc: -1, dr: 0 },  // 左
        { dc: 1, dr: 0 }    // 右
    ];

    const seen = new Set();
    for (const fc of furnitureCells) {
        for (const dir of directions) {
            const nc = fc.col + dir.dc;
            const nr = fc.row + dir.dr;
            const key = nc + ',' + nr;
            if (seen.has(key)) continue;
            if (isCellWalkable(nc, nr)) {
                seen.add(key);
                result.push({ col: nc, row: nr, cell: getGridCell(nc, nr) });
            }
        }
    }
    return result;
}

// 检查必要家具是否都已放置，返回缺失的家具类型列表
function checkRequiredFurniture() {
    const missing = [];
    for (const ft of REQUIRED_FURNITURE) {
        const cells = findFurnitureCells(ft);
        if (cells.length === 0) {
            missing.push(ft);
        }
    }
    return missing;
}

// 根据行为类型找到目标格子或相邻格子
// action 取值: 'eat' | 'sleep' | 'toilet' | 'bathe' | 'watch_tv'
// 优先返回家具相邻的可通行格子（让桌宠站到家具旁），无则返回家具格子本身
// 返回: { col, row, cell } 或 null
function getFurnitureActionTarget(action) {
    if (!action) return null;

    // 找到所有具有该行为的家具类型
    const matchingTypes = [];
    for (const type in FURNITURE_TYPES) {
        if (FURNITURE_TYPES[type].action === action) {
            matchingTypes.push(type);
        }
    }
    if (matchingTypes.length === 0) return null;

    // 优先找相邻可通行格子
    for (const ft of matchingTypes) {
        const adjacent = findFurnitureAdjacentCells(ft);
        if (adjacent.length > 0) {
            return adjacent[Math.floor(Math.random() * adjacent.length)];
        }
    }

    // 没有相邻格子，返回家具格子本身
    for (const ft of matchingTypes) {
        const cells = findFurnitureCells(ft);
        if (cells.length > 0) {
            return cells[Math.floor(Math.random() * cells.length)];
        }
    }

    return null;
}


// ============================================================
// 网格渲染函数
// ============================================================

// ============================================================
// 双模式坐标转换
// 网格坐标 (col, row) → 屏幕坐标 (x, y)
// viewMode: 'square' | 'diamond'
//   square: 标准方格坐标 x=col*cellSize, y=row*cellSize
//   diamond: 等轴测坐标 (col-row)*halfW, (col+row)*halfH
// ============================================================
function gridToScreen(col, row, cellSize, offsetX, offsetY, viewMode) {
    if (viewMode === 'square') {
        return {
            x: col * cellSize + offsetX,
            y: row * cellSize + offsetY
        };
    }
    // diamond (isometric)
    const halfW = cellSize / 2;
    const halfH = cellSize / 4;
    return {
        x: (col - row) * halfW + offsetX,
        y: (col + row) * halfH + offsetY
    };
}

// 屏幕坐标 (x, y) → 网格坐标 (col, row)
function screenToGrid(screenX, screenY, cellSize, offsetX, offsetY, viewMode) {
    const relX = screenX - offsetX;
    const relY = screenY - offsetY;
    if (viewMode === 'square') {
        return {
            col: Math.round(relX / cellSize),
            row: Math.round(relY / cellSize)
        };
    }
    // diamond (isometric)
    const halfW = cellSize / 2;
    const halfH = cellSize / 4;
    const col = Math.round((relX / halfW + relY / halfH) / 2);
    const row = Math.round((relY / halfH - relX / halfW) / 2);
    return { col, row };
}

// 根据房子尺寸和网格列数行数，计算格子大小和居中偏移量
// viewMode: 'square' | 'diamond'
// houseRect: { width, height }
// customCellSize: 可选，用户指定的格子像素大小
// 返回: { cellSize, offsetX, offsetY }
function calculateGridLayout(houseRect, gridCols, gridRows, customCellSize, viewMode) {
    const width = (houseRect && houseRect.width) || 800;
    const height = (houseRect && houseRect.height) || 600;
    const cols = gridCols || GRID_COLS;
    const rows = gridRows || GRID_ROWS;
    const mode = viewMode || 'square';

    let autoCellSize;
    if (mode === 'diamond') {
        // 等轴测网格总尺寸
        const totalColsRows = cols + rows;
        const cellSizeByWidth = (width * 2) / totalColsRows;
        const cellSizeByHeight = (height * 4) / totalColsRows;
        autoCellSize = Math.min(cellSizeByWidth, cellSizeByHeight);
    } else {
        // 正方形网格
        const cellSizeByWidth = width / cols;
        const cellSizeByHeight = height / rows;
        autoCellSize = Math.min(cellSizeByWidth, cellSizeByHeight);
    }

    let cellSize = autoCellSize;
    if (customCellSize && customCellSize > 0) {
        cellSize = Math.min(customCellSize, autoCellSize);
    }

    let offsetX, offsetY;
    if (mode === 'diamond') {
        // 等轴测居中
        const avgCol = (cols - 1) / 2;
        const avgRow = (rows - 1) / 2;
        const centerX = (avgCol - avgRow) * cellSize / 2;
        const centerY = (avgCol + avgRow) * cellSize / 4;
        offsetX = width / 2 - centerX;
        offsetY = height / 2 - centerY;
    } else {
        // 正方形居中
        const gridWidth = cellSize * cols;
        const gridHeight = cellSize * rows;
        offsetX = (width - gridWidth) / 2;
        offsetY = (height - gridHeight) / 2;
    }

    return { cellSize, offsetX, offsetY };
}

// 创建格子背景层 div
// bgSize: 可选，自定义 background-size（如墙贴图用 '100% 100%' 填满）
function createCellBg(className, bgColor, bgImage, bgPosition, bgSize) {
    const bg = document.createElement('div');
    bg.className = 'grid-cell-bg ' + (className || '');
    if (bgColor) bg.style.background = bgColor;
    if (bgImage) {
        bg.style.backgroundImage = bgImage;
        bg.style.backgroundColor = 'transparent';
        bg.style.backgroundSize = bgSize || 'cover';
        bg.style.backgroundRepeat = 'no-repeat';
        if (bgPosition) {
            bg.style.backgroundPosition = bgPosition;
        } else {
            bg.style.backgroundPosition = 'center center';
        }
    }
    return bg;
}

// 创建 emoji 层 span
function createCellEmoji(emoji, fontSize) {
    const span = document.createElement('span');
    span.className = 'grid-cell-emoji';
    span.textContent = emoji;
    if (fontSize) span.style.fontSize = fontSize;
    return span;
}

// 创建家具图片元素
// imageName: 图片文件名（不含扩展名），对应 /img/{imageName}.png
// mirrored: 是否水平镜像
// width, height: 图片容器宽高（像素）
// scale: 贴图放大倍数（默认1）
function createCellImage(imageName, mirrored, width, height, scale) {
    const img = document.createElement('img');
    img.className = 'grid-cell-img';
    img.src = imgPath(encodeURIComponent(imageName) + '.png');
    img.style.width = width + 'px';
    img.style.height = height + 'px';
    img.style.objectFit = 'contain';
    img.style.position = 'absolute';
    img.style.left = '50%';
    img.style.top = '50%';
    img.style.pointerEvents = 'none';
    let transform = 'translate(-50%, -50%)';
    if (scale && scale !== 1) transform += ' scale(' + scale + ')';
    if (mirrored) transform += ' scaleX(-1)';
    img.style.transform = transform;
    return img;
}

// 渲染网格到 house 元素中
// viewMode: 'square' | 'diamond'
// z-index 策略：y 越大越靠前（等轴测视角中屏幕下方靠近观察者）
//   - 地板：z=0（永远在最底层）
//   - 墙面/家具：z-index 动态更新，基于底部 y 坐标排序
//   - 桌宠：z-index 动态更新，参与排序
const GRID_Z_SCALE = 5;
function renderGrid(houseElement, gridOffsetX, gridOffsetY, cellSize, viewMode) {
    if (!petGrid || !houseElement) return null;
    if (!cellSize || cellSize <= 0) return null;
    const mode = viewMode || 'square';

    // 网格重建后所有元素引用失效，清空 z-index 缓存
    cachedZItems = null;

    const oldElements = houseElement.querySelectorAll('.room, .wall, .furniture, .grid-container');
    oldElements.forEach(function (el) { el.remove(); });

    const container = document.createElement('div');
    container.className = 'grid-container';
    container.style.position = 'static';
    container.style.pointerEvents = 'none';

    const isDiamond = mode === 'diamond';

    // 使用 DocumentFragment 批量插入，避免循环中每次 appendChild 都触发重排
    const cellFragment = document.createDocumentFragment();

    for (let r = 0; r < petGrid.rows; r++) {
        for (let c = 0; c < petGrid.cols; c++) {
            const cell = petGrid.cells[r][c];
            const cellDiv = document.createElement('div');
            cellDiv.className = 'grid-cell' + (isDiamond ? ' diamond' : ' square');
            cellDiv.style.position = 'absolute';
            cellDiv.style.display = 'flex';
            cellDiv.style.alignItems = 'center';
            cellDiv.style.justifyContent = 'center';

            // 计算屏幕坐标
            const pos = gridToScreen(c, r, cellSize, gridOffsetX, gridOffsetY, mode);

            // 两格高墙：高度为2倍cellSize，底部对齐菱形地板底部
            // 普通墙：高度为cellSize，仅位移使底部对齐菱形地板底部
            const isDoubleWall = (cell.type === 'wall' && cell.wallType === 'double');
            let cellHeight;
            if (isDiamond) {
                cellHeight = isDoubleWall ? (cellSize * 2) : cellSize;
            } else {
                cellHeight = isDoubleWall ? (cellSize * 2) : cellSize;
            }

            if (isDiamond) {
                const diamondHeight = cellSize / 2;
                // 菱形地板底部 y 坐标：pos.y + diamondHeight/2
                const diamondBottom = pos.y + diamondHeight / 2;
                if (cell.type === 'wall') {
                    // 墙：保持原始高度，底部对齐菱形地板底部
                    cellDiv.style.left = (pos.x - cellSize / 2) + 'px';
                    cellDiv.style.top = (diamondBottom - cellHeight) + 'px';
                    cellDiv.style.width = cellSize + 'px';
                    cellDiv.style.height = cellHeight + 'px';
                } else {
                    // 地板：以网格位置为中心
                    cellDiv.style.left = (pos.x - cellSize / 2) + 'px';
                    cellDiv.style.top = (pos.y - diamondHeight / 2) + 'px';
                    cellDiv.style.width = cellSize + 'px';
                    cellDiv.style.height = diamondHeight + 'px';
                }
            } else {
                // 正方形模式
                if (cell.type === 'wall') {
                    // 墙：底部对齐网格位置
                    cellDiv.style.left = pos.x + 'px';
                    cellDiv.style.top = (pos.y - cellHeight + cellSize) + 'px';
                    cellDiv.style.width = cellSize + 'px';
                    cellDiv.style.height = cellHeight + 'px';
                } else {
                    // 地板：格子对齐网格
                    cellDiv.style.left = pos.x + 'px';
                    cellDiv.style.top = pos.y + 'px';
                    cellDiv.style.width = cellSize + 'px';
                    cellDiv.style.height = cellSize + 'px';
                }
            }

            // 背景层
            let bgColor = null;
            let bgClass = '';
            let bgImage = null;
            if (cell.type === 'wall') {
                bgClass = isDiamond ? 'grid-wall-diamond' : 'grid-wall';
                cellDiv.classList.add('grid-wall');
                if (isDiamond) {
                    if (isDoubleWall) {
                        bgImage = "url('" + imgPath(encodeURIComponent('墙面（两格高）') + ".png") + "')";
                    } else {
                        bgImage = "url('" + imgPath(encodeURIComponent('墙面') + ".png") + "')";
                    }
                } else {
                    bgColor = (petGrid.customColors && petGrid.customColors.wall) || '#3e2723';
                }
            } else {
                bgClass = isDiamond ? 'grid-floor-diamond' : 'grid-floor';
                cellDiv.classList.add('grid-floor');
                if (cell.room && ROOM_TYPES[cell.room]) {
                    bgClass += ' grid-floor-' + cell.room;
                    const roomColors = (petGrid.customColors && petGrid.customColors.floor) || {};
                    bgColor = roomColors[cell.room] || ROOM_TYPES[cell.room].defaultColor || ROOM_TYPES[cell.room].color;
                } else {
                    bgClass += ' grid-floor-default';
                    const roomColors = (petGrid.customColors && petGrid.customColors.floor) || {};
                    bgColor = roomColors['default'] || petGrid.defaultFloorColor || '#f5f5f5';
                }
            }
            const bgPos = (cell.type === 'wall') ? 'center bottom' : null;
            const bgSize = (cell.type === 'wall' && isDiamond) ? '100% 100%' : null;
            const bgDiv = createCellBg(bgClass, bgColor, bgImage, bgPos, bgSize);
            cellDiv.appendChild(bgDiv);

            cellDiv.style.opacity = cell.type === 'wall' ? 'var(--wall-opacity)' : 'var(--floor-opacity)';

            cellFragment.appendChild(cellDiv);
        }
    }
    container.appendChild(cellFragment);

    // 渲染家具到同一个 container 中（与墙面在同一层叠上下文）
    const furnitureFragment = document.createDocumentFragment();
    for (let r = 0; r < petGrid.rows; r++) {
        for (let c = 0; c < petGrid.cols; c++) {
            const cell = petGrid.cells[r][c];
            if (!cell.furniture) continue;

            const furDef = FURNITURE_TYPES[cell.furniture.type];
            if (!furDef) continue;

            const pos = gridToScreen(c, r, cellSize, gridOffsetX, gridOffsetY, mode);

            const furDiv = document.createElement('div');
            furDiv.className = 'grid-furniture-item';
            // 标记家具类型，便于行为系统查找 DOM 元素并替换贴图变体（如做饭/吃饭/洗澡/坐沙发）
            furDiv.setAttribute('data-furniture-type', cell.furniture.type);
            furDiv.style.position = 'absolute';
            furDiv.style.pointerEvents = 'none';

            let furWidth, furHeight;
            if (isDiamond) {
                const diamondHeight = cellSize / 2;
                furWidth = cellSize;
                furHeight = diamondHeight;
                furDiv.style.left = (pos.x - cellSize / 2) + 'px';
                // 上移半个地块高度（菱形模式下地块显示高度为 cellSize/2，上移 cellSize/2）
                furDiv.style.top = (pos.y - diamondHeight / 2 - cellSize / 2) + 'px';
            } else {
                furWidth = cellSize;
                furHeight = cellSize;
                furDiv.style.left = pos.x + 'px';
                // 上移半个地块高度
                furDiv.style.top = (pos.y - cellSize / 2) + 'px';
            }
            furDiv.style.width = furWidth + 'px';
            furDiv.style.height = furHeight + 'px';

            // 家具基础放大倍数：默认2倍，衣柜3倍，灶台/浴室4倍；
            // 再乘以 TEXTURE_SCALE 中该家具的额外贴图缩放（如沙发1.2、床1.3）
            const imgScale = getFurnitureFinalScale(cell.furniture.type, null);

            if (furDef.image) {
                const img = createCellImage(furDef.image, cell.furniture.mirrored, furWidth, furHeight, imgScale);
                furDiv.appendChild(img);
            } else {
                const emojiSpan = createCellEmoji(furDef.emoji, (cellSize * 0.6) + 'px');
                furDiv.appendChild(emojiSpan);
            }

            furnitureFragment.appendChild(furDiv);
        }
    }
    container.appendChild(furnitureFragment);

    houseElement.appendChild(container);
    return container;
}


// ============================================================
// 房间检测函数
// ============================================================

// 将像素坐标转换为网格坐标，返回该格子的房间类型
// 如果是地板格子返回 room 类型，否则返回 null
function getRoomAtPixel(x, y, gridOffsetX, gridOffsetY, cellSize, viewMode) {
    if (!petGrid || !cellSize || cellSize <= 0) return null;
    const gridPos = screenToGrid(x, y, cellSize, gridOffsetX, gridOffsetY, viewMode);
    return getRoomAtGrid(gridPos.col, gridPos.row);
}

// 返回指定网格坐标的房间类型
// 如果是地板格子返回 room 类型，否则返回 null
function getRoomAtGrid(col, row) {
    const cell = getGridCell(col, row);
    if (!cell) return null;
    if (cell.type !== 'floor') return null;
    return cell.room;
}

// ============================================================
// 动态 z-index 更新函数
// 根据所有墙面、家具和桌宠的底部 y 坐标进行排序
// y 坐标越小（屏幕上方）越靠后，y 坐标越大（屏幕下方）越靠前
// ============================================================
// z-index 缓存：墙面/家具元素在网格布局不变时位置恒定，
// 仅桌宠移动时无需重新查询 DOM。缓存为按 y 升序排列的 {el, y} 数组。
// renderGrid 会清空此缓存；updateGridZIndex（全量重建）会填充此缓存。
let cachedZItems = null;

function updateGridZIndex(houseElement, gridOffsetX, gridOffsetY, cellSize, viewMode, petY) {
    if (!houseElement) return;
    const mode = viewMode || 'square';
    const isDiamond = mode === 'diamond';
    const houseRect = houseElement.getBoundingClientRect();

    const allItems = [];

    // 收集墙面格子
    const wallCells = houseElement.querySelectorAll('.grid-cell.grid-wall');
    wallCells.forEach(function (el) {
        const rect = el.getBoundingClientRect();
        const bottomY = rect.top + rect.height - houseRect.top;
        allItems.push({ el: el, y: bottomY });
    });

    // 收集家具（y坐标增加半个格子高度，形成正确的遮挡关系）
    const furnitures = houseElement.querySelectorAll('.grid-furniture-item');
    furnitures.forEach(function (el) {
        const rect = el.getBoundingClientRect();
        const bottomY = rect.top + rect.height - houseRect.top + cellSize * 0.5;
        allItems.push({ el: el, y: bottomY });
    });

    // 按 y 坐标排序（y 小=屏幕上方=靠后）
    allItems.sort(function (a, b) { return a.y - b.y; });

    // 分配 z-index（从 50 开始递增）
    allItems.forEach(function (item, i) {
        item.el.style.zIndex = 50 + i;
    });

    // 缓存排序结果，供 updatePetZIndex 在桌宠移动时复用（避免重复 DOM 查询/重排）
    cachedZItems = allItems;

    // 桌宠也参与排序
    const pet = document.getElementById('pet');
    if (pet && typeof petY === 'number' && !isNaN(petY)) {
        // petY 是桌宠的脚部/底部 y 坐标，偏移 cellSize * 0.25 以形成正确的遮挡关系
        let petBottomY = petY + cellSize * 0.25;
        if (!isDiamond) {
            petBottomY = petY + pet.offsetHeight / 2 + cellSize * 0.25;
        }

        // 找到桌宠应该插入的位置
        let petZ = 50;
        for (let i = 0; i < allItems.length; i++) {
            if (petBottomY <= allItems[i].y) {
                petZ = 50 + i;
                break;
            }
            petZ = 50 + i + 1;
        }
        pet.style.zIndex = petZ;
    }
}

// 轻量级桌宠 z-index 更新：仅根据缓存的墙面/家具 y 坐标计算桌宠 z-index。
// 热路径（桌宠每 30ms 移动一次）调用此函数，避免 querySelectorAll + getBoundingClientRect
// 造成的数千次强制重排/秒，这是主窗口卡顿与 "Memory read timeout" 的根因。
// petHeightEl：桌宠高度（来自 JS 变量 petHeight，避免读取 offsetHeight 触发重排）
function updatePetZIndex(houseElement, gridOffsetX, gridOffsetY, cellSize, viewMode, petY, petHeightEl) {
    if (!houseElement) return;
    // 缓存为空（首次或 renderGrid 后未全量重建过）：退化为全量重建并填充缓存
    if (!cachedZItems) {
        updateGridZIndex(houseElement, gridOffsetX, gridOffsetY, cellSize, viewMode, petY);
        return;
    }
    const mode = viewMode || 'square';
    const isDiamond = mode === 'diamond';
    const pet = document.getElementById('pet');
    if (!pet || typeof petY !== 'number' || isNaN(petY)) return;

    // petY 是桌宠的脚部/底部 y 坐标，偏移 cellSize * 0.25 以形成正确的遮挡关系
    let petBottomY = petY + cellSize * 0.25;
    if (!isDiamond) {
        // 正方形模式下 petY 是中心，加 petHeight/2 取底部；用传入的 petHeightEl 避免 offsetHeight 重排
        petBottomY = petY + (petHeightEl || pet.offsetHeight) / 2 + cellSize * 0.25;
    }

    // 二分查找桌宠应插入的位置（cachedZItems 已按 y 升序）
    const items = cachedZItems;
    let lo = 0, hi = items.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (petBottomY <= items[mid].y) {
            hi = mid;
        } else {
            lo = mid + 1;
        }
    }
    // petZ = 50 + lo（与全量函数中“找到第一个 petBottomY <= y 的位置”一致）
    pet.style.zIndex = 50 + lo;
}

// 根据屏幕 y 坐标计算 z-index（y 越大越靠前）
// 桌宠和格子使用同一公式，确保按 y 正确排序
function getZIndexByScreenY(screenY) {
    return 1 + Math.floor(screenY / GRID_Z_SCALE);
}
