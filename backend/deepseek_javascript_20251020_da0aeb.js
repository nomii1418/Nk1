const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const axios = require('axios');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/mechanical_aspirants';
mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
});

// MongoDB Schemas
const userSchema = new mongoose.Schema({
    username: String,
    lastActive: { type: Date, default: Date.now },
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
    telegramFileId: String, // Store Telegram file ID instead of local file
    fileUrl: String, // Direct download URL from Telegram
    metadata: Object,
    uploadedBy: String,
    createdAt: { type: Date, default: Date.now },
    views: { type: Number, default: 0 },
    downloads: { type: Number, default: 0 }
});

const adminSchema = new mongoose.Schema({
    username: { type: String, unique: true },
    password: String,
    telegramId: String,
    sessionToken: String,
    lastLogin: Date
});

const sessionSchema = new mongoose.Schema({
    adminId: mongoose.Schema.Types.ObjectId,
    token: String,
    createdAt: { type: Date, default: Date.now, expires: 86400 } // 24 hours
});

// Models
const User = mongoose.model('User', userSchema);
const Subject = mongoose.model('Subject', subjectSchema);
const Content = mongoose.model('Content', contentSchema);
const Admin = mongoose.model('Admin', adminSchema);
const Session = mongoose.model('Session', sessionSchema);

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
        console.log('✅ Default admin created: nk28/nom');
    }
}

// Session-based Authentication Middleware
const authenticateAdmin = async (req, res, next) => {
    try {
        const token = req.headers.authorization;
        
        if (!token) {
            return res.status(401).json({ 
                success: false, 
                error: 'Authentication required' 
            });
        }

        const session = await Session.findOne({ token }).populate('adminId');
        if (!session) {
            return res.status(401).json({ 
                success: false, 
                error: 'Invalid or expired session' 
            });
        }

        req.admin = session.adminId;
        next();
    } catch (error) {
        res.status(401).json({ 
            success: false, 
            error: 'Authentication failed' 
        });
    }
};

// Generate session token
function generateSessionToken() {
    return require('crypto').randomBytes(32).toString('hex');
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
            // Create session
            const sessionToken = generateSessionToken();
            await Session.create({
                adminId: admin._id,
                token: sessionToken
            });

            // Update last login
            admin.lastLogin = new Date();
            await admin.save();

            res.json({ 
                success: true, 
                token: sessionToken,
                admin: {
                    username: admin.username,
                    telegramId: admin.telegramId
                }
            });
        } else {
            res.status(401).json({ 
                success: false, 
                error: 'Invalid credentials' 
            });
        }
    } catch (error) {
        res.status(500).json({ error: 'Login failed' });
    }
});

// Admin logout
app.post('/api/admin/logout', authenticateAdmin, async (req, res) => {
    try {
        const token = req.headers.authorization;
        await Session.deleteOne({ token });
        res.json({ success: true, message: 'Logged out successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Logout failed' });
    }
});

// Verify session
app.get('/api/admin/verify', authenticateAdmin, async (req, res) => {
    res.json({ 
        success: true, 
        admin: {
            username: req.admin.username,
            telegramId: req.admin.telegramId
        }
    });
});

// Add subject (admin only)
app.post('/api/admin/subjects', authenticateAdmin, async (req, res) => {
    try {
        const { name, description } = req.body;
        const subject = new Subject({ 
            name, 
            description, 
            createdBy: req.admin.username 
        });
        await subject.save();
        res.json({ success: true, subject });
    } catch (error) {
        res.status(500).json({ error: 'Failed to add subject' });
    }
});

// Delete subject (admin only)
app.delete('/api/admin/subjects/:id', authenticateAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        await Subject.findByIdAndDelete(id);
        // Also delete associated content
        await Content.deleteMany({ subjectId: id });
        res.json({ success: true, message: 'Subject deleted' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete subject' });
    }
});

// Add content (admin only) - Using Telegram file storage
app.post('/api/admin/content', authenticateAdmin, async (req, res) => {
    try {
        const { subjectId, type, title, description, telegramFileId, fileUrl } = req.body;
        
        const content = new Content({
            subjectId,
            type,
            title,
            description,
            telegramFileId,
            fileUrl,
            uploadedBy: req.admin.username
        });

        await content.save();
        res.json({ success: true, content });
    } catch (error) {
        res.status(500).json({ error: 'Failed to add content' });
    }
});

// Delete content (admin only)
app.delete('/api/admin/content/:id', authenticateAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        await Content.findByIdAndDelete(id);
        res.json({ success: true, message: 'Content deleted' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete content' });
    }
});

// Get platform statistics
app.get('/api/admin/stats', authenticateAdmin, async (req, res) => {
    try {
        const subjectsCount = await Subject.countDocuments();
        const videosCount = await Content.countDocuments({ type: 'video' });
        const filesCount = await Content.countDocuments({ type: 'file' });
        const usersCount = await User.countDocuments();
        const contentCount = await Content.countDocuments();

        res.json({
            subjects: subjectsCount,
            videos: videosCount,
            files: filesCount,
            users: usersCount,
            totalContent: contentCount
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch statistics' });
    }
});

// Get all content for admin management
app.get('/api/admin/content', authenticateAdmin, async (req, res) => {
    try {
        const { subjectId, contentType } = req.query;
        let query = {};
        
        if (subjectId) query.subjectId = subjectId;
        if (contentType) query.type = contentType;
        
        const content = await Content.find(query)
            .populate('subjectId')
            .sort({ createdAt: -1 });
            
        res.json(content);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch content' });
    }
});

// Update content (admin only)
app.put('/api/admin/content/:id', authenticateAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;
        
        const content = await Content.findByIdAndUpdate(
            id, 
            updates, 
            { new: true }
        );
        
        res.json({ success: true, content });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update content' });
    }
});

// Track content view
app.post('/api/content/:id/view', async (req, res) => {
    try {
        const { id } = req.params;
        await Content.findByIdAndUpdate(id, { $inc: { views: 1 } });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to track view' });
    }
});

// Telegram webhook for file handling
app.post('/api/telegram/webhook', async (req, res) => {
    try {
        const { message } = req.body;
        
        if (message && message.document) {
            // Handle file upload from Telegram bot
            const fileId = message.document.file_id;
            const fileName = message.document.file_name;
            const chatId = message.chat.id;
            
            // You can process the file here or let the bot handle it
            console.log(`File received: ${fileName} (ID: ${fileId}) from chat: ${chatId}`);
        }
        
        res.json({ success: true });
    } catch (error) {
        console.error('Telegram webhook error:', error);
        res.status(500).json({ error: 'Webhook processing failed' });
    }
});

// Get file download URL from Telegram
app.get('/api/files/:fileId/download', async (req, res) => {
    try {
        const { fileId } = req.params;
        
        // Get file info from Telegram
        const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
        const response = await axios.get(
            `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`
        );
        
        if (response.data.ok) {
            const filePath = response.data.result.file_path;
            const downloadUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`;
            
            res.json({ 
                success: true, 
                downloadUrl,
                filePath 
            });
        } else {
            res.status(404).json({ error: 'File not found' });
        }
    } catch (error) {
        res.status(500).json({ error: 'Failed to get download URL' });
    }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        service: 'Mechanical Aspirants API'
    });
});

// Initialize and start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    await initializeAdmin();
    console.log(`🚀 Mechanical Aspirants API running on port ${PORT}`);
    console.log(`🔐 Default admin: nk28 / nom`);
    console.log(`📚 API Documentation: http://localhost:${PORT}/api/health`);
});