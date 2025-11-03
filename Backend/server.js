// Load environment variables from a .env file if the dotenv package is available.
try {
  // eslint-disable-next-line import/no-extraneous-dependencies, global-require
  require('dotenv').config();
} catch (err) {
  // dotenv is optional; if it's missing we silently continue. Environment
  // variables can still be provided via process.env.
  if (process.env.DEBUG) {
    console.warn('dotenv module not found; skipping .env loading');
  }
}

const express = require('express');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const { execFile } = require('child_process');
const crypto = require('crypto');

// Attempt to load Firebase token verification if available. This is used for
// existing Supabase upload endpoints. If the module isn't present or the
// environment isn't configured for Firebase, these endpoints will still
// function by returning an authentication error.
let verifyFirebaseToken = () => Promise.reject(new Error('Firebase auth not configured'));
try {
  // eslint-disable-next-line import/no-unresolved, global-require
  ({ verifyFirebaseToken } = require('./authFirebase'));
} catch (err) {
  // No Firebase module present; ignore.
}

// Attempt to load Supabase client if API credentials are provided. If
// SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY are missing, the Supabase
// integration will be disabled and uploads will fall back to local storage.
let supabase = null;
try {
  // eslint-disable-next-line import/no-unresolved, global-require
  const { createClient } = require('@supabase/supabase-js');
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (supabaseUrl && supabaseKey) {
    supabase = createClient(supabaseUrl, supabaseKey);
  }
} catch (err) {
  // Supabase SDK is not installed; ignore.
}

const app = express();

// Base directory for storing uploaded files and generated previews
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const PREVIEW_DIR = path.join(__dirname, 'static');

// Create directories if they do not exist
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(PREVIEW_DIR)) fs.mkdirSync(PREVIEW_DIR, { recursive: true });

// Multer setup: store files in memory before processing
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: Number(process.env.MAX_UPLOAD_MB || 10) * 1024 * 1024 }
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Basic CORS middleware. This replicates the functionality of the 'cors'
// package but does not depend on any external module. It allows any
// origin, supports credentials and common headers.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  return next();
});

/**
 * Run a ImageMagick command. The first argument should be the program name
 * ("magick"), followed by subsequent arguments. Returns a promise that
 * resolves when the command finishes. Rejects on error.
 *
 * @param {string[]} args Command line arguments for ImageMagick
 */
function runMagick(args) {
  return new Promise((resolve, reject) => {
    execFile('magick', args, (error, stdout, stderr) => {
      if (error) {
        console.error('[Magick error]', stderr || error.message);
        return reject(error);
      }
      return resolve({ stdout, stderr });
    });
  });
}

// Map of preset output sizes used for rendering. The keys correspond to the
// values provided by the "size" select on the settings page. If a size is
// missing from this map, the service will attempt to parse it as WIDTHxHEIGHT.
const SIZE_MAP = {
  '1000x1000': { w: 1000, h: 1000 },
  '750x975': { w: 750, h: 975 },
  '900x1200': { w: 900, h: 1200 },
  '1200x1500': { w: 1200, h: 1500 },
  '1524x1905': { w: 1524, h: 1905 },
  '1200x1800': { w: 1200, h: 1800 },
  '1080x1080': { w: 1080, h: 1080 },
  '600x600': { w: 600, h: 600 },
  '390x567': { w: 390, h: 567 },
  '450x600': { w: 450, h: 600 }
};

// Map uniform codes to filenames in the Frontend/images/uniforms directory.
const UNIFORM_FILE_MAP = {
  'womensuit': 'womensuit.png',
  'mansuit': 'mansuit.png',
  'boys-school-uniform': "boy's-school-uniform.png",
  'girls-school-uniform': "girl's-school-uniform.png",
  'mens-university-uniform': "men's-university-uniform.png",
  'womens-university-uniform': "women's-university-uniform.png"
};

/**
 * Helper to find the original uploaded file for a given base name. The
 * uploaded file is stored in the UPLOAD_DIR with the pattern
 * `${baseName}-original.<ext>`. This function returns the absolute path
 * to the first matching file or null if none exist.
 *
 * @param {string} baseName Base file identifier
 * @returns {string|null} Absolute path to the original file
 */
function findOriginalFile(baseName) {
  const files = fs.readdirSync(UPLOAD_DIR);
  for (const f of files) {
    if (f.startsWith(`${baseName}-original`)) {
      return path.join(UPLOAD_DIR, f);
    }
  }
  return null;
}

/**
 * Convert a hex color (e.g. "#FFFFFF") to a format accepted by ImageMagick.
 * ImageMagick accepts both named colors and hex with "#". We strip the hash
 * if present because in some cases passing the hash directly can confuse
 * command parsing. This function safely returns the color without the
 * leading "#".
 *
 * @param {string} color Hex color string
 * @returns {string} Sanitized color string
 */
function sanitizeColor(color) {
  if (!color) return 'FFFFFF';
  return color.replace(/^#/, '');
}

/**
 * POST /api/image/process
 *
 * Accepts a single image file uploaded by the client. The file is saved to
 * the uploads directory and a preview is generated. The response includes
 * the relative URL of the preview image and a base identifier for future
 * processing.
 */
app.post('/api/image/process', upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    // Generate a base identifier using random bytes and timestamp
    const baseId = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    // Determine original extension
    const ext = path.extname(req.file.originalname).toLowerCase() || '.png';
    const originalName = `${baseId}-original${ext}`;
    const originalPath = path.join(UPLOAD_DIR, originalName);

    // Save the original file to disk
    fs.writeFileSync(originalPath, req.file.buffer);

    // Create a preview image. Use ImageMagick to resize the original to
    // 600x600 pixels for preview without changing aspect ratio. The "600x600>"
    // syntax means shrink the image only if it exceeds these dimensions.
    const previewName = `${baseId}-preview.png`;
    const previewPath = path.join(PREVIEW_DIR, previewName);
    await runMagick([
      originalPath,
      '-auto-orient',
      '-resize', '600x600>',
      previewPath
    ]);

    // Prepare a preview URL. Default to serving from the local static directory.
    let previewUrl = `/static/${previewName}`;
    // If Supabase is configured, upload the preview image to Supabase Storage and
    // return a signed URL to the client. Wrap in try/catch so any errors here
    // don't prevent the normal response. Files are uploaded into a `previews`
    // folder inside the configured bucket. On success, remove the local file.
    if (supabase) {
      const bucket = process.env.SUPABASE_BUCKET || 'user-uploads';
      const remotePath = `previews/${previewName}`;
      try {
        const fileBuffer = fs.readFileSync(previewPath);
        const { error: upErr } = await supabase.storage.from(bucket).upload(remotePath, fileBuffer, {
          contentType: 'image/png',
          upsert: true
        });
        if (!upErr) {
          const { data: signed, error: signErr } = await supabase.storage.from(bucket).createSignedUrl(remotePath, 24 * 60 * 60);
          if (!signErr && signed && signed.signedUrl) {
            previewUrl = signed.signedUrl;
            try {
              fs.unlinkSync(previewPath);
            } catch (remErr) {
              /* ignore removal errors */
            }
          }
        }
      } catch (supErr) {
        console.error('[Supabase upload preview]', supErr);
      }
    }

    return res.json({ preview: previewUrl, fileBase: baseId });
  } catch (err) {
    console.error('[image/process]', err);
    return res.status(500).json({ error: 'Processing failed', detail: err.message || String(err) });
  }
});

/**
 * POST /api/image/render
 *
 * Renders a new image based on the uploaded base image, desired output size,
 * background color and optional uniform overlay. The client supplies the
 * base identifier returned by the process endpoint. The server locates the
 * original upload, resizes and crops it using ImageMagick with a north
 * gravity to preserve the top of the head, fills the background with the
 * specified color, and composites a uniform if provided. The response
 * includes a new preview URL and a new base identifier representing this
 * rendered file.
 */
app.post('/api/image/render', async (req, res) => {
  try {
    const { fileBase, size, bgcolor, uniform } = req.body || {};
    // Optional uniform scales and offsets.
    // uniformScaleX and uniformScaleY represent percentage values (50-200) for width and height respectively.
    const scaleInputX = parseFloat((req.body && req.body.uniformScaleX) || '100');
    const scaleInputY = parseFloat((req.body && req.body.uniformScaleY) || '100');
    const offsetPctX = parseFloat((req.body && req.body.uniformOffsetX) || '0');
    const offsetPctY = parseFloat((req.body && req.body.uniformOffsetY) || '0');
    const scaleFactorX = Number.isFinite(scaleInputX) ? scaleInputX / 100 : 1.0;
    const scaleFactorY = Number.isFinite(scaleInputY) ? scaleInputY / 100 : 1.0;
    // Cropping geometry parameters (0-100). Defaults to full frame if not provided.
    const cropX = Number(req.body && req.body.cropX) || 0;
    const cropY = Number(req.body && req.body.cropY) || 0;
    const cropW = Number(req.body && req.body.cropW) || 100;
    const cropH = Number(req.body && req.body.cropH) || 100;
    // Brightness and contrast adjustments (0-200). Convert to range -100..100
    const brightnessInput = Number(req.body && req.body.brightness) || 100;
    const contrastInput = Number(req.body && req.body.contrast) || 100;
    const brightnessAdj = brightnessInput - 100;
    const contrastAdj = contrastInput - 100;
    if (!fileBase) return res.status(400).json({ error: 'Missing fileBase' });

    // Determine target dimensions. Use provided size from map or parse string.
    let dim = SIZE_MAP[size];
    if (!dim) {
      // Attempt to parse "WIDTHxHEIGHT" pattern
      const match = /^\s*(\d+)x(\d+)\s*$/i.exec(size || '');
      if (match) {
        dim = { w: parseInt(match[1], 10), h: parseInt(match[2], 10) };
      }
    }
    if (!dim) return res.status(400).json({ error: 'Invalid size parameter' });
    const width = dim.w;
    const height = dim.h;

    // Find the original uploaded file
    const originalPath = findOriginalFile(fileBase);
    if (!originalPath || !fs.existsSync(originalPath)) {
      return res.status(404).json({ error: 'Original file not found' });
    }

    // Prepare filenames for intermediate and final outputs
    const renderedBaseId = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const tmpBasePath = path.join(UPLOAD_DIR, `${renderedBaseId}-base.png`);
    const finalName = `${renderedBaseId}-rendered.png`;
    const finalPath = path.join(PREVIEW_DIR, finalName);

    // Sanitize background color to remove leading '#'
    const hexColor = sanitizeColor(bgcolor || 'FFFFFF');

    // Build cropping geometry string for ImageMagick (percentage-based). ImageMagick accepts
    // geometry in the format "{w}%x{h}%+{x}%+{y}%" where values are percentages.
    const cropGeometry = `${cropW}%x${cropH}%+${cropX}%+${cropY}%`;
    // Step 1: Crop the original image based on provided geometry, reset the page offset,
    // resize to the desired output size, extend canvas to maintain aspect ratio,
    // fill with the background color, and adjust brightness/contrast.
    await runMagick([
      originalPath,
      '-auto-orient',
      '-crop', cropGeometry,
      '+repage',
      '-resize', `${width}x${height}^`,
      '-gravity', 'north',
      '-background', `#${hexColor}`,
      '-extent', `${width}x${height}`,
      '-brightness-contrast', `${brightnessAdj}x${contrastAdj}`,
      tmpBasePath
    ]);

    // Step 2: If a uniform is selected and we have a matching file, overlay
    // it on top of the resized image. Resize the uniform based on the
    // requested scale factor and composite with a horizontal offset.
    if (uniform && UNIFORM_FILE_MAP[uniform]) {
      const uniformFile = UNIFORM_FILE_MAP[uniform];
      const uniformPath = path.join(__dirname, '../Frontend/images/uniforms', uniformFile);
      if (!fs.existsSync(uniformPath)) {
        return res.status(404).json({ error: 'Uniform file not found' });
      }
      const tmpUniformPath = path.join(UPLOAD_DIR, `${renderedBaseId}-uniform.png`);
      // Calculate uniform dimensions based on independent scale factors. Use overall output size
      // to determine the scaled width/height of the uniform overlay.
      const uniformW = Math.max(1, Math.round(width * scaleFactorX));
      const uniformH = Math.max(1, Math.round(height * scaleFactorY));
      // Resize the uniform image to these dimensions
      await runMagick([
        uniformPath,
        '-resize', `${uniformW}x${uniformH}`,
        tmpUniformPath
      ]);
      // Compute horizontal offset in pixels from percentage of output width
      // Compute horizontal and vertical offsets in pixels from percentage of output width/height
      const offsetPxX = Math.round((offsetPctX / 100) * width);
      const offsetPxY = Math.round((offsetPctY / 100) * height);
      // Format geometry string: positive numbers require a '+' prefix for both axes,
      // negative numbers include '-' from their sign. Note that ImageMagick geometry uses
      // +x+y format where x offsets horizontally and y offsets vertically.
      const geoX = offsetPxX >= 0 ? `+${offsetPxX}` : `${offsetPxX}`;
      const geoY = offsetPxY >= 0 ? `+${offsetPxY}` : `${offsetPxY}`;
      const geometry = `${geoX}${geoY}`;
      // Composite the uniform on top of the base image with offsets and scale
      await runMagick([
        tmpBasePath,
        tmpUniformPath,
        '-geometry', geometry,
        '-compose', 'over',
        '-composite',
        finalPath
      ]);
      // Remove temporary uniform image
      fs.unlink(tmpUniformPath, (err) => { if (err) console.error('Could not delete tmp uniform', err); });
    } else {
      // If no uniform, copy the base to final
      await runMagick([
        tmpBasePath,
        finalPath
      ]);
    }

    // Remove the temporary base image
    fs.unlink(tmpBasePath, (err) => { if (err) console.error('Could not delete tmp base', err); });

    // Prepare a preview URL for the rendered file. Default to serving from the local static directory.
    let previewUrl = `/static/${finalName}`;
    // If Supabase is configured, upload the rendered image to Supabase Storage and provide
    // a signed URL in the response. Upload into a `renders` folder in the bucket. If
    // the upload and signed URL generation succeed, remove the local file to avoid
    // serving it from disk.
    if (supabase) {
      const bucket = process.env.SUPABASE_BUCKET || 'user-uploads';
      const remotePath = `renders/${finalName}`;
      try {
        const fileBuffer = fs.readFileSync(finalPath);
        const { error: upErr } = await supabase.storage.from(bucket).upload(remotePath, fileBuffer, {
          contentType: 'image/png',
          upsert: true
        });
        if (!upErr) {
          const { data: signed, error: signErr } = await supabase.storage.from(bucket).createSignedUrl(remotePath, 24 * 60 * 60);
          if (!signErr && signed && signed.signedUrl) {
            previewUrl = signed.signedUrl;
            try {
              fs.unlinkSync(finalPath);
            } catch (remErr) {
              /* ignore removal errors */
            }
          }
        }
      } catch (supErr) {
        console.error('[Supabase upload render]', supErr);
      }
    }

    return res.json({ preview: previewUrl, fileBase: renderedBaseId });
  } catch (err) {
    console.error('[image/render]', err);
    return res.status(500).json({ error: 'Render failed', detail: err.message || String(err) });
  }
});

/**
 * GET /api/image/download
 *
 * Downloads a rendered image in the specified format. The client must supply
 * the base identifier and the desired format (png, jpg, or pdf). The server
 * locates the corresponding rendered image and converts it on the fly using
 * ImageMagick. The resulting file is sent as a binary download.
 */
app.get('/api/image/download', async (req, res) => {
  try {
    const { filename, format } = req.query;
    if (!filename) return res.status(400).json({ error: 'Missing filename' });
    const fmt = (format || 'png').toLowerCase();
    if (!['png', 'jpg', 'jpeg', 'pdf'].includes(fmt)) {
      return res.status(400).json({ error: 'Unsupported format' });
    }

    // Find the rendered file in the preview directory
    const files = fs.readdirSync(PREVIEW_DIR);
    let inputPath = null;
    for (const f of files) {
      if (f.startsWith(filename) && f.endsWith('.png')) {
        inputPath = path.join(PREVIEW_DIR, f);
        break;
      }
    }
    if (!inputPath || !fs.existsSync(inputPath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Prepare a temporary output file in /tmp
    const tmpOutput = path.join('/tmp', `${filename}.${fmt === 'jpeg' ? 'jpg' : fmt}`);
    // Convert the image to the requested format
    await runMagick([
      inputPath,
      tmpOutput
    ]);
    const data = fs.readFileSync(tmpOutput);
    // Clean up temporary file
    fs.unlink(tmpOutput, (err) => { if (err) console.error('Could not delete tmp output', err); });

    // Set appropriate headers for download
    const contentTypes = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      pdf: 'application/pdf'
    };
    res.setHeader('Content-Type', contentTypes[fmt]);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.${fmt}"`);
    return res.end(data);
  } catch (err) {
    console.error('[image/download]', err);
    return res.status(500).json({ error: 'Download failed', detail: err.message || String(err) });
  }
});

/**
 * Existing Supabase endpoints from the original project. These routes are
 * preserved to maintain backwards compatibility. They allow uploading to
 * Supabase Storage and generating signed URLs. If Supabase credentials are
 * missing or the SDK is unavailable, these endpoints will still respond
 * appropriately with error messages.
 */
app.post('/api/upload-supabase', upload.single('file'), async (req, res) => {
  try {
    // Expect a Firebase ID token for authentication
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing Authorization Bearer token' });

    // Verify Firebase token if possible
    let decoded;
    try {
      decoded = await verifyFirebaseToken(token);
    } catch (err) {
      return res.status(401).json({ error: 'Invalid token', detail: err.message || String(err) });
    }
    const uid = decoded.uid;

    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    if (!supabase) {
      return res.status(503).json({ error: 'Supabase not configured' });
    }
    const bucket = process.env.SUPABASE_BUCKET || 'user-uploads';
    const safeName = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filename = `${Date.now()}_${safeName}`;
    const objectPath = `users/${uid}/${filename}`;
    const { error: upErr } = await supabase.storage.from(bucket).upload(objectPath, req.file.buffer, {
      contentType: req.file.mimetype || 'application/octet-stream',
      upsert: false
    });
    if (upErr) {
      console.error('[Supabase upload error]', upErr);
      return res.status(500).json({ error: 'Upload failed', detail: upErr.message || upErr });
    }
    const expiresIn = 60 * 60;
    const { data: signed, error: signErr } = await supabase.storage.from(bucket).createSignedUrl(objectPath, expiresIn);
    if (signErr) {
      console.error('[Supabase signed url error]', signErr);
      return res.status(500).json({ error: 'Signed URL failed', detail: signErr.message || signErr });
    }
    return res.json({ bucket, path: objectPath, signedUrl: signed && signed.signedUrl, expiresIn });
  } catch (err) {
    console.error('[upload-supabase]', err);
    return res.status(500).json({ error: 'Internal error', detail: err.message || String(err) });
  }
});

app.post('/api/signed-url', async (req, res) => {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing Authorization Bearer token' });
    let decoded;
    try {
      decoded = await verifyFirebaseToken(token);
    } catch (err) {
      return res.status(401).json({ error: 'Invalid token', detail: err.message || String(err) });
    }
    const uid = decoded.uid;
    const { path: objectPath, expiresInSeconds } = req.body || {};
    if (!objectPath) return res.status(400).json({ error: 'Missing path' });
    if (!supabase) {
      return res.status(503).json({ error: 'Supabase not configured' });
    }
    if (!objectPath.startsWith(`users/${uid}/`)) {
      return res.status(403).json({ error: 'Forbidden: can only sign your own files' });
    }
    const bucket = process.env.SUPABASE_BUCKET || 'user-uploads';
    const expiresIn = Number(expiresInSeconds || 3600);
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(objectPath, expiresIn);
    if (error) return res.status(500).json({ error: error.message || error });
    return res.json({ signedUrl: data && data.signedUrl, expiresIn });
  } catch (err) {
    console.error('[signed-url]', err);
    return res.status(500).json({ error: 'Internal error', detail: err.message || String(err) });
  }
});

// Serve static files for generated previews and the frontend
app.use('/static', express.static(PREVIEW_DIR));
// Determine the frontend directory (either Frontend or frontend)
let frontendDir = path.join(__dirname, '../Frontend');
if (!fs.existsSync(frontendDir)) {
  frontendDir = path.join(__dirname, '../frontend');
}
app.use(express.static(frontendDir));

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});