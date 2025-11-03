const express = require('express');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const app = express();
const PORT = 4000;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const PREVIEW_DIR = path.join(__dirname, 'static');

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Ensure upload and static directories exist
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);
if (!fs.existsSync(PREVIEW_DIR)) fs.mkdirSync(PREVIEW_DIR);

// Serve static files (the "processed" images)
app.use('/static', express.static(PREVIEW_DIR));

// Multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOAD_DIR);
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname);
    }
});
const upload = multer({ storage: storage });

// API Image Processing Routes
app.post('/api/image/process', upload.single('photo'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    const fileBase = path.parse(req.file.filename).name;
    const finalImagePath = path.join(PREVIEW_DIR, fileBase + '.jpg');
    fs.copyFileSync(req.file.path, finalImagePath);

    res.status(200).json({ 
        message: 'Image processed successfully', 
        fileBase: fileBase,
        preview: `/static/${fileBase}.jpg`
    });
});

app.post('/api/image/render', (req, res) => {
    const { fileBase, size, bgcolor, uniform } = req.body;
    if (!fileBase) {
        return res.status(400).json({ error: 'File base name is required' });
    }

    // --- Placeholder for actual image rendering logic ---
    // In a real application, you would perform image processing here,
    // like changing background color or size. For now, we'll just
    // send back a placeholder path.
    const finalImagePath = `/static/${fileBase}-rendered.jpg`;
    res.status(200).json({
        message: 'Image settings applied',
        fileBase: fileBase,
        preview: finalImagePath
    });
});

app.get('/api/image/download', (req, res) => {
    const { filename, format } = req.query;
    if (!filename || !format) {
        return res.status(400).json({ error: 'Filename and format are required' });
    }
    
    const filePath = path.join(PREVIEW_DIR, filename + '.jpg');

    if (fs.existsSync(filePath)) {
        res.download(filePath, `profile-photo-${filename}.${format}`, (err) => {
            if (err) {
                console.error('Error downloading file:', err);
                res.status(500).json({ error: 'Download failed' });
            }
        });
    } else {
        res.status(404).json({ error: 'File not found' });
    }
});

// Serve frontend files
app.use(express.static(path.join(__dirname, '../frontend')));

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
});
