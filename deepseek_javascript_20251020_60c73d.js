const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/mechanical_aspirants';
mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
});

// MongoDB Schemas
const userSchema = new mongoose.Schema({
    username: String,
    lastActive: Date,
    contentAccessed: { type: Number, default: 0 }
});

const subjectSchema = new mongoose.Schema({
    name: String,
    description: String,
    createdBy: String,
    createdAt: { type: Date, default: Date.now }
});

const contentSchema = new mongoose.Schema({
    subjectId: mongoose.Schema.Types.ObjectId,
    type: String, // video, file, topic, quiz, tips
    title: String,
    description: String,
    url: String,
    metadata: Object,
    uploadedBy: String,
    createdAt: { type: Date, default: Date.now },
    views: { type: Number, default: 0 },
    downloads: { type: Number, default: 0 }
});

const adminSchema = new mongoose.Schema({
    username: { type: String, unique: true },
    password: String,
    telegramId: String
});

const analyticsSchema = new mongoose.Schema({
    totalVisits: { type: Number, default: 0 },
    contentViews: { type: Number, default: 0 },
    popularContent: Array,
    lastUpdated: { type: Date, default: Date.now }
});

// Models
const User = mongoose.model('User', userSchema);
const Subject = mongoose.model('Subject', subjectSchema);
const Content = mongoose.model('Content', contentSchema);
const Admin = mongoose.model('Admin', adminSchema);
const Analytics = mongoose.model('Analytics', analyticsSchema);

// File upload configuration
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/')
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname)
    }
});

const upload = multer({ storage: storage });

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

// Initialize default admin
async function initializeAdmin() {
    const existingAdmin = await Admin.findOne({ username: 'nk28' });
    if (!existingAdmin) {
        const hashedPassword = await bcrypt.hash('nom', 10);
        await Admin.create({
            username: 'nk28',
            password: hashedPassword,
            telegramId: '6056498996'
        });
        console.log('Default admin created: nk28/nom');
    }
}

// Routes

// Get all subjects
app.get('/api/subjects', async (req, res) => {
    try {
        const subjects = await Subject.find().sort({ createdAt: -1 });
        res.json(subjects);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch subjects' });
    }
});

// Get content by subject and type
app.get('/api/content/:subjectId/:contentType', async (req, res) => {
    try {
        const { subjectId, contentType } = req.params;
        const subject = await Subject.findById(subjectId);
        const content = await Content.find({ 
            subjectId: subjectId, 
            type: contentType 
        }).sort({ createdAt: -1 });

        res.json({
            subjectName: subject?.name || 'Unknown Subject',
            items: content
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch content' });
    }
});

// Admin login
app.post('/api/admin/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const admin = await Admin.findOne({ username });

        if (admin && await bcrypt.compare(password, admin.password)) {
            const token = jwt.sign({ username: admin.username }, JWT_SECRET);
            res.json({ success: true, token });
        } else {
            res.json({ success: false, error: 'Invalid credentials' });
        }
    } catch (error) {
        res.status(500).json({ error: 'Login failed' });
    }
});

// Add subject (admin only)
app.post('/api/admin/subjects', async (req, res) => {
    try {
        const { name, description } = req.body;
        const subject = new Subject({ name, description, createdBy: 'admin' });
        await subject.save();
        res.json({ success: true, subject });
    } catch (error) {
        res.status(500).json({ error: 'Failed to add subject' });
    }
});

// Upload content (admin only)
app.post('/api/admin/content', upload.single('file'), async (req, res) => {
    try {
        const { subjectId, type, title, description } = req.body;
        const fileUrl = req.file ? `/uploads/${req.file.filename}` : null;

        const content = new Content({
            subjectId,
            type,
            title,
            description,
            url: fileUrl,
            uploadedBy: 'admin',
            metadata: req.file ? {
                filename: req.file.filename,
                originalname: req.file.originalname,
                size: req.file.size,
                mimetype: req.file.mimetype
            } : {}
        });

        await content.save();
        res.json({ success: true, content });
    } catch (error) {
        res.status(500).json({ error: 'Failed to upload content' });
    }
});

// Get platform statistics
app.get('/api/admin/stats', async (req, res) => {
    try {
        const subjectsCount = await Subject.countDocuments();
        const videosCount = await Content.countDocuments({ type: 'video' });
        const filesCount = await Content.countDocuments({ type: 'file' });
        const usersCount = await User.countDocuments();

        res.json({
            subjects: subjectsCount,
            videos: videosCount,
            files: filesCount,
            users: usersCount
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch statistics' });
    }
});

// Telegram bot webhook
app.post('/api/telegram/webhook', async (req, res) => {
    try {
        const { message } = req.body;
        
        if (message && message.text) {
            const chatId = message.chat.id;
            const text = message.text.toLowerCase();
            
            // Handle bot commands
            if (text === '/start') {
                // Send welcome message with admin options
                await sendTelegramMessage(chatId, 
                    'Welcome to Mechanical Aspirants Bot!\n\n' +
                    'Available commands:\n' +
                    '/addsubject - Add new subject\n' +
                    '/addcontent - Add content\n' +
                    '/stats - View platform statistics\n' +
                    '/upload - Upload file'
                );
            } else if (text === '/stats') {
                const stats = await getPlatformStats();
                await sendTelegramMessage(chatId, 
                    `Platform Statistics:\n\n` +
                    `Subjects: ${stats.subjects}\n` +
                    `Videos: ${stats.videos}\n` +
                    `Files: ${stats.files}\n` +
                    `Users: ${stats.users}`
                );
            }
        }
        
        res.json({ success: true });
    } catch (error) {
        console.error('Telegram webhook error:', error);
        res.status(500).json({ error: 'Webhook processing failed' });
    }
});

// Helper function to send Telegram message
async function sendTelegramMessage(chatId, text) {
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    if (!TELEGRAM_BOT_TOKEN) return;

    try {
        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                chat_id: chatId,
                text: text
            })
        });
    } catch (error) {
        console.error('Error sending Telegram message:', error);
    }
}

// Get platform statistics
async function getPlatformStats() {
    const subjectsCount = await Subject.countDocuments();
    const videosCount = await Content.countDocuments({ type: 'video' });
    const filesCount = await Content.countDocuments({ type: 'file' });
    const usersCount = await User.countDocuments();

    return { subjects: subjectsCount, videos: videosCount, files: filesCount, users: usersCount };
}

// Initialize and start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    await initializeAdmin();
    console.log(`Server running on port ${PORT}`);
});