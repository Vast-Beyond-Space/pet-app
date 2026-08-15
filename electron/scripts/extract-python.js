/**
 * 解压嵌入式 Python 运行时脚本
 * 在 postinstall 阶段执行，将 python-3.11.9-embed-amd64.zip 解压到 electron/python/
 */
const path = require('path');
const fs = require('fs');

const ZIP_PATH = path.join(__dirname, '..', 'python-3.11.9-embed-amd64.zip');
const EXTRACT_DIR = path.join(__dirname, '..', 'python');
const PYTHON_EXE = path.join(EXTRACT_DIR, 'python.exe');

// 如果 python.exe 已存在，跳过解压
if (fs.existsSync(PYTHON_EXE)) {
    console.log('[extract-python] python.exe 已存在，跳过解压');
    process.exit(0);
}

// 检查 zip 文件是否存在
if (!fs.existsSync(ZIP_PATH)) {
    console.error('[extract-python] 未找到 zip 文件：' + ZIP_PATH);
    console.error('[extract-python] 请将 python-3.11.9-embed-amd64.zip 放在 electron/ 目录下');
    process.exit(1);
}

try {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(ZIP_PATH);

    // 确保目标目录存在
    if (!fs.existsSync(EXTRACT_DIR)) {
        fs.mkdirSync(EXTRACT_DIR, { recursive: true });
    }

    // 解压所有文件
    zip.extractAllTo(EXTRACT_DIR, true);
    console.log('[extract-python] 解压完成：' + EXTRACT_DIR);
} catch (e) {
    console.error('[extract-python] 解压失败：', e.message);
    process.exit(1);
}