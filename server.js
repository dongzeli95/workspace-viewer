import express from 'express';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || join(__dirname, '..');
const PORT = 3500;
const CRITICAL_ONLY = String(process.env.CRITICAL_ONLY || 'false').toLowerCase() === 'true';
const SHOW_CONFIG_BACKUPS = String(process.env.SHOW_CONFIG_BACKUPS || 'false').toLowerCase() === 'true';

// Curated OpenClaw paths that are operationally important.
const CRITICAL_DIR_PREFIXES = [
  'workspace',
  'hooks',
  'cron',
  'subagents',
  'logs',
  'identity',
  'devices',
  'canvas',
  'agents/main/agent',
  'agents/main/qmd',
  'agents/main/sessions',
];

const CRITICAL_ROOT_CONFIG_NAMES = ['openclaw.json', 'clawdbot.json'];

function normalizeRelPath(relPath) {
  return String(relPath || '')
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')
    .replace(/\/+$/, '');
}

function isSameOrDescendant(path, prefix) {
  return path === prefix || path.startsWith(`${prefix}/`);
}

function isAncestor(path, prefix) {
  return prefix === path || prefix.startsWith(`${path}/`);
}

function getRootConfigVisibility(filename) {
  const lower = String(filename || '').toLowerCase();
  for (const base of CRITICAL_ROOT_CONFIG_NAMES) {
    if (lower === base) return { isPrimary: true, isBackup: false };
    if (lower.startsWith(`${base}.`)) return { isPrimary: false, isBackup: true };
  }
  return { isPrimary: false, isBackup: false };
}

function shouldIncludePath(relPath, isDir, filename) {
  if (!CRITICAL_ONLY) return true;

  const p = normalizeRelPath(relPath);
  if (!p) return true;

  if (isDir) {
    return CRITICAL_DIR_PREFIXES.some(
      (prefix) => isAncestor(p, prefix) || isSameOrDescendant(p, prefix)
    );
  }

  // Keep key root-level OpenClaw configs visible, backups optional.
  if (!p.includes('/')) {
    const cfg = getRootConfigVisibility(filename);
    if (cfg.isPrimary) return true;
    if (cfg.isBackup) return SHOW_CONFIG_BACKUPS;
  }

  const inCriticalDir = CRITICAL_DIR_PREFIXES.some((prefix) =>
    isSameOrDescendant(p, prefix)
  );
  if (!inCriticalDir) return false;

  return true;
}

// Supported file extensions by category
const TEXT_EXTENSIONS = new Set([
  '.txt', '.js', '.ts', '.tsx', '.jsx', '.json', '.jsonl',
  '.yaml', '.yml', '.toml', '.sh', '.bash', '.css', '.html',
  '.xml', '.sql', '.py', '.env', '.gitignore', '.log', '.csv',
  '.sqlite', '.sqlite-wal', '.sqlite-shm',
]);

const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp',
]);

const PDF_EXTENSIONS = new Set(['.pdf']);

const MARKDOWN_EXTENSIONS = new Set(['.md']);

// Map file extensions to hljs language names
const EXT_TO_LANG = {
  '.js': 'javascript', '.ts': 'typescript', '.tsx': 'typescript',
  '.jsx': 'javascript', '.json': 'json', '.jsonl': 'json',
  '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'ini',
  '.sh': 'bash', '.bash': 'bash', '.css': 'css', '.html': 'xml',
  '.xml': 'xml', '.sql': 'sql', '.py': 'python', '.csv': 'plaintext',
  '.txt': 'plaintext', '.log': 'plaintext', '.env': 'bash',
  '.gitignore': 'plaintext',
};

// MIME types for images
const IMAGE_MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
};

function getFileCategory(filename) {
  const cfg = getRootConfigVisibility(filename);
  if (cfg.isPrimary || cfg.isBackup) return 'text';

  const ext = extname(filename).toLowerCase();
  // Files without extension (like .gitignore, .env) — check full name
  if (!ext) {
    const base = filename.toLowerCase();
    if (TEXT_EXTENSIONS.has('.' + base)) return 'text';
    return null;
  }
  if (MARKDOWN_EXTENSIONS.has(ext)) return 'markdown';
  if (TEXT_EXTENSIONS.has(ext)) return 'text';
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (PDF_EXTENSIONS.has(ext)) return 'pdf';
  return null;
}

function isSupported(filename) {
  return getFileCategory(filename) !== null;
}

// Set up marked with syntax highlighting
const marked = new Marked(
  markedHighlight({
    langPrefix: 'hljs language-',
    highlight(code, lang) {
      if (lang && hljs.getLanguage(lang)) {
        return hljs.highlight(code, { language: lang }).value;
      }
      return hljs.highlightAuto(code).value;
    },
  })
);

const app = express();
app.use(express.static(join(__dirname, 'public')));

// Build directory tree of supported files
async function buildTree(dir, rootDir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const items = [];

  // Sort: directories first, then files, both alphabetical
  const sorted = entries
    .filter((e) => e.name !== 'node_modules' && !(e.isDirectory() && e.name.startsWith('.')))
    .sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

  for (const entry of sorted) {
    const fullPath = join(dir, entry.name);
    const relPath = relative(rootDir, fullPath);
    if (!shouldIncludePath(relPath, entry.isDirectory(), entry.name)) continue;

    if (entry.isDirectory()) {
      const children = await buildTree(fullPath, rootDir);
      // Only include directories that contain supported files (directly or nested)
      if (children.length > 0) {
        items.push({ name: entry.name, path: relPath, type: 'dir', children });
      }
    } else if (isSupported(entry.name)) {
      const category = getFileCategory(entry.name);
      items.push({ name: entry.name, path: relPath, type: 'file', category });
    }
  }

  return items;
}

// API: get directory tree
app.get('/api/tree', async (req, res) => {
  try {
    const tree = await buildTree(WORKSPACE_ROOT, WORKSPACE_ROOT);
    res.json(tree);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: get file content
app.get('/api/file', async (req, res) => {
  try {
    const filePath = req.query.path;
    if (!filePath) return res.status(400).json({ error: 'path required' });

    // Prevent directory traversal
    const resolved = join(WORKSPACE_ROOT, filePath);
    if (!resolved.startsWith(WORKSPACE_ROOT)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const info = await stat(resolved);
    if (!info.isFile()) {
      return res.status(400).json({ error: 'not a file' });
    }

    const filename = filePath.split('/').pop();
    if (!shouldIncludePath(filePath, false, filename)) {
      return res.status(403).json({ error: 'outside critical scope' });
    }
    const category = getFileCategory(filename);
    if (!category) {
      return res.status(400).json({ error: 'unsupported file type' });
    }

    const ext = extname(filename).toLowerCase();

    if (category === 'markdown') {
      const content = await readFile(resolved, 'utf-8');
      const html = await marked.parse(content);
      res.json({ category: 'markdown', path: filePath, html, raw: content });

    } else if (category === 'text') {
      const content = await readFile(resolved, 'utf-8');
      const lang = EXT_TO_LANG[ext] || 'plaintext';
      let highlighted;
      if (lang !== 'plaintext' && hljs.getLanguage(lang)) {
        highlighted = hljs.highlight(content, { language: lang }).value;
      } else {
        highlighted = hljs.highlightAuto(content).value;
      }
      res.json({ category: 'text', path: filePath, highlighted, raw: content, lang });

    } else if (category === 'image') {
      const data = await readFile(resolved);
      const base64 = data.toString('base64');
      const mime = IMAGE_MIME[ext] || 'application/octet-stream';
      res.json({ category: 'image', path: filePath, dataUrl: `data:${mime};base64,${base64}` });

    } else if (category === 'pdf') {
      res.json({ category: 'pdf', path: filePath, downloadUrl: `api/raw?path=${encodeURIComponent(filePath)}` });
    }
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'file not found' });
    res.status(500).json({ error: err.message });
  }
});

// API: serve raw file (for PDF embed/download and images)
app.get('/api/raw', async (req, res) => {
  try {
    const filePath = req.query.path;
    if (!filePath) return res.status(400).json({ error: 'path required' });

    // Prevent directory traversal
    const resolved = join(WORKSPACE_ROOT, filePath);
    if (!resolved.startsWith(WORKSPACE_ROOT)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const info = await stat(resolved);
    if (!info.isFile()) {
      return res.status(400).json({ error: 'not a file' });
    }

    const filename = filePath.split('/').pop();
    if (!shouldIncludePath(filePath, false, filename)) {
      return res.status(403).json({ error: 'outside critical scope' });
    }
    const ext = extname(filename).toLowerCase();
    const category = getFileCategory(filename);
    if (!category) {
      return res.status(400).json({ error: 'unsupported file type' });
    }

    if (category === 'pdf') {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    } else if (category === 'image') {
      res.setHeader('Content-Type', IMAGE_MIME[ext] || 'application/octet-stream');
    } else {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    }

    const data = await readFile(resolved);
    res.send(data);
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'file not found' });
    res.status(500).json({ error: err.message });
  }
});

// API: search files
app.get('/api/search', async (req, res) => {
  try {
    const query = (req.query.q || '').toLowerCase().trim();
    if (!query) return res.json([]);

    const results = [];
    async function search(dir) {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === 'node_modules') continue;
        if (entry.isDirectory() && entry.name.startsWith('.')) continue;
        const fullPath = join(dir, entry.name);
        const relPath = relative(WORKSPACE_ROOT, fullPath);
        if (!shouldIncludePath(relPath, entry.isDirectory(), entry.name)) continue;
        if (entry.isDirectory()) {
          await search(fullPath);
        } else if (isSupported(entry.name)) {
          if (relPath.toLowerCase().includes(query)) {
            const category = getFileCategory(entry.name);
            results.push({ path: relPath, category });
          }
          if (results.length >= 30) return;
        }
      }
    }
    await search(WORKSPACE_ROOT);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`.openclaw viewer running at http://0.0.0.0:${PORT}`);
  console.log(`Serving files from: ${WORKSPACE_ROOT}`);
});
