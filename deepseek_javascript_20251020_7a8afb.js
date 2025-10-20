const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
require('dotenv').config();

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const BACKEND_URL = process.env.BACKEND_URL || 'https://your-backend-url.onrender.com';

// Initialize bot
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

// Store user states for multi-step commands
const userStates = new Map();

// Admin ID
const ADMIN_ID = '6056498996';

// Bot commands
bot.setMyCommands([
    { command: 'start', description: 'Start the bot' },
    { command: 'addsubject', description: 'Add new subject (Admin only)' },
    { command: 'addcontent', description: 'Add content to subject (Admin only)' },
    { command: 'upload', description: 'Upload file (Admin only)' },
    { command: 'stats', description: 'View platform statistics' }
]);

// Handle /start command
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    
    if (chatId.toString() === ADMIN_ID) {
        bot.sendMessage(chatId,
            '👋 Welcome to Mechanical Aspirants Admin Bot!\n\n' +
            '🤖 Available Admin Commands:\n' +
            '📚 /addsubject - Add new subject\n' +
            '📝 /addcontent - Add content to subject\n' +
            '📁 /upload - Upload file with categorization\n' +
            '📊 /stats - View platform statistics\n' +
            '👥 /users - View user analytics\n' +
            '🔄 /sync - Sync data with website'
        );
    } else {
        bot.sendMessage(chatId,
            '👋 Welcome to Mechanical Aspirants!\n\n' +
            'This bot is for admin use only. ' +
            'Please visit our website for learning resources.'
        );
    }
});

// Handle /stats command
bot.onText(/\/stats/, async (msg) => {
    const chatId = msg.chat.id;
    
    try {
        const response = await axios.get(`${BACKEND_URL}/api/admin/stats`);
        const stats = response.data;
        
        bot.sendMessage(chatId,
            `📊 Platform Statistics:\n\n` +
            `📚 Subjects: ${stats.subjects}\n` +
            `🎥 Videos: ${stats.videos}\n` +
            `📁 Files: ${stats.files}\n` +
            `👥 Active Users: ${stats.users}`
        );
    } catch (error) {
        bot.sendMessage(chatId, '❌ Failed to fetch statistics');
    }
});

// Handle /addsubject command (Admin only)
bot.onText(/\/addsubject/, (msg) => {
    const chatId = msg.chat.id;
    
    if (chatId.toString() !== ADMIN_ID) {
        bot.sendMessage(chatId, '❌ This command is for admins only');
        return;
    }
    
    userStates.set(chatId, { command: 'addsubject', step: 1 });
    bot.sendMessage(chatId, '📚 Adding new subject\n\nPlease enter the subject name:');
});

// Handle /addcontent command (Admin only)
bot.onText(/\/addcontent/, (msg) => {
    const chatId = msg.chat.id;
    
    if (chatId.toString() !== ADMIN_ID) {
        bot.sendMessage(chatId, '❌ This command is for admins only');
        return;
    }
    
    // First, get available subjects
    axios.get(`${BACKEND_URL}/api/subjects`)
        .then(response => {
            const subjects = response.data;
            if (subjects.length === 0) {
                bot.sendMessage(chatId, '❌ No subjects available. Please add a subject first.');
                return;
            }
            
            let subjectList = '📝 Select a subject for adding content:\n\n';
            subjects.forEach((subject, index) => {
                subjectList += `${index + 1}. ${subject.name}\n`;
            });
            
            userStates.set(chatId, { 
                command: 'addcontent', 
                step: 1, 
                subjects: subjects 
            });
            
            bot.sendMessage(chatId, subjectList + '\nPlease reply with the subject number:');
        })
        .catch(error => {
            bot.sendMessage(chatId, '❌ Failed to fetch subjects');
        });
});

// Handle /upload command (Admin only)
bot.onText(/\/upload/, (msg) => {
    const chatId = msg.chat.id;
    
    if (chatId.toString() !== ADMIN_ID) {
        bot.sendMessage(chatId, '❌ This command is for admins only');
        return;
    }
    
    bot.sendMessage(chatId,
        '📁 File Upload\n\n' +
        'Please send the file you want to upload.\n\n' +
        'After sending the file, you will be asked to:\n' +
        '1. Select subject\n' +
        '2. Enter content type\n' +
        '3. Add title and description'
    );
});

// Handle text messages for multi-step commands
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    const state = userStates.get(chatId);
    
    if (!state || !text) return;
    
    try {
        if (state.command === 'addsubject') {
            await handleAddSubject(chatId, text, state);
        } else if (state.command === 'addcontent') {
            await handleAddContent(chatId, text, state);
        }
    } catch (error) {
        console.error('Error handling message:', error);
        bot.sendMessage(chatId, '❌ An error occurred. Please try again.');
        userStates.delete(chatId);
    }
});

// Handle file uploads
bot.on('document', async (msg) => {
    const chatId = msg.chat.id;
    
    if (chatId.toString() !== ADMIN_ID) {
        bot.sendMessage(chatId, '❌ File upload is for admins only');
        return;
    }
    
    const fileId = msg.document.file_id;
    const fileName = msg.document.file_name;
    
    try {
        // Download the file
        const fileStream = bot.getFileStream(fileId);
        const chunks = [];
        
        for await (const chunk of fileStream) {
            chunks.push(chunk);
        }
        
        const fileBuffer = Buffer.concat(chunks);
        
        // Get subjects for categorization
        const subjectsResponse = await axios.get(`${BACKEND_URL}/api/subjects`);
        const subjects = subjectsResponse.data;
        
        if (subjects.length === 0) {
            bot.sendMessage(chatId, '❌ No subjects available. Please add a subject first.');
            return;
        }
        
        let subjectList = '📚 Select subject for file categorization:\n\n';
        subjects.forEach((subject, index) => {
            subjectList += `${index + 1}. ${subject.name}\n`;
        });
        
        userStates.set(chatId, {
            command: 'upload',
            step: 1,
            fileBuffer: fileBuffer,
            fileName: fileName,
            subjects: subjects
        });
        
        bot.sendMessage(chatId, subjectList + '\nPlease reply with the subject number:');
        
    } catch (error) {
        console.error('File upload error:', error);
        bot.sendMessage(chatId, '❌ Failed to process file upload');
    }
});

// Handle add subject flow
async function handleAddSubject(chatId, text, state) {
    if (state.step === 1) {
        // Step 1: Get subject name
        state.subjectName = text;
        state.step = 2;
        userStates.set(chatId, state);
        bot.sendMessage(chatId, 'Please enter the subject description:');
    } else if (state.step === 2) {
        // Step 2: Get subject description and save
        const subjectDescription = text;
        
        try {
            const response = await axios.post(`${BACKEND_URL}/api/admin/subjects`, {
                name: state.subjectName,
                description: subjectDescription
            });
            
            if (response.data.success) {
                bot.sendMessage(chatId, `✅ Subject "${state.subjectName}" added successfully!`);
            } else {
                bot.sendMessage(chatId, '❌ Failed to add subject');
            }
        } catch (error) {
            bot.sendMessage(chatId, '❌ Failed to add subject');
        }
        
        userStates.delete(chatId);
    }
}

// Handle add content flow
async function handleAddContent(chatId, text, state) {
    if (state.step === 1) {
        // Step 1: Select subject
        const subjectIndex = parseInt(text) - 1;
        if (isNaN(subjectIndex) || subjectIndex < 0 || subjectIndex >= state.subjects.length) {
            bot.sendMessage(chatId, '❌ Invalid subject number. Please try again.');
            return;
        }
        
        state.selectedSubject = state.subjects[subjectIndex];
        state.step = 2;
        userStates.set(chatId, state);
        
        bot.sendMessage(chatId,
            '📝 Select content type:\n\n' +
            '1. Video\n' +
            '2. File\n' +
            '3. Topic\n' +
            '4. Quiz\n' +
            '5. Tips\n\n' +
            'Please reply with the content type number:'
        );
    } else if (state.step === 2) {
        // Step 2: Select content type
        const typeMap = { '1': 'video', '2': 'file', '3': 'topic', '4': 'quiz', '5': 'tips' };
        const contentType = typeMap[text];
        
        if (!contentType) {
            bot.sendMessage(chatId, '❌ Invalid content type. Please try again.');
            return;
        }
        
        state.contentType = contentType;
        state.step = 3;
        userStates.set(chatId, state);
        
        bot.sendMessage(chatId, 'Please enter the content title:');
    } else if (state.step === 3) {
        // Step 3: Get content title
        state.contentTitle = text;
        state.step = 4;
        userStates.set(chatId, state);
        
        bot.sendMessage(chatId, 'Please enter the content description:');
    } else if (state.step === 4) {
        // Step 4: Get content description and save
        const contentDescription = text;
        
        try {
            const response = await axios.post(`${BACKEND_URL}/api/admin/content`, {
                subjectId: state.selectedSubject._id,
                type: state.contentType,
                title: state.contentTitle,
                description: contentDescription
            });
            
            if (response.data.success) {
                bot.sendMessage(chatId, 
                    `✅ Content added successfully!\n\n` +
                    `Subject: ${state.selectedSubject.name}\n` +
                    `Type: ${state.contentType}\n` +
                    `Title: ${state.contentTitle}`
                );
            } else {
                bot.sendMessage(chatId, '❌ Failed to add content');
            }
        } catch (error) {
            bot.sendMessage(chatId, '❌ Failed to add content');
        }
        
        userStates.delete(chatId);
    }
}

// Handle file upload flow
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    const state = userStates.get(chatId);
    
    if (!state || state.command !== 'upload' || !text) return;
    
    try {
        if (state.step === 1) {
            // Step 1: Select subject
            const subjectIndex = parseInt(text) - 1;
            if (isNaN(subjectIndex) || subjectIndex < 0 || subjectIndex >= state.subjects.length) {
                bot.sendMessage(chatId, '❌ Invalid subject number. Please try again.');
                return;
            }
            
            state.selectedSubject = state.subjects[subjectIndex];
            state.step = 2;
            userStates.set(chatId, state);
            
            bot.sendMessage(chatId,
                '📝 Select content type for the file:\n\n' +
                '1. Video\n' +
                '2. File\n' +
                '3. Study Material\n\n' +
                'Please reply with the content type number:'
            );
        } else if (state.step === 2) {
            // Step 2: Select content type
            const typeMap = { '1': 'video', '2': 'file', '3': 'file' };
            const contentType = typeMap[text];
            
            if (!contentType) {
                bot.sendMessage(chatId, '❌ Invalid content type. Please try again.');
                return;
            }
            
            state.contentType = contentType;
            state.step = 3;
            userStates.set(chatId, state);
            
            bot.sendMessage(chatId, 'Please enter the title for this file:');
        } else if (state.step === 3) {
            // Step 3: Get file title
            state.fileTitle = text;
            state.step = 4;
            userStates.set(chatId, state);
            
            bot.sendMessage(chatId, 'Please enter a description for this file:');
        } else if (state.step === 4) {
            // Step 4: Get description and upload file
            const fileDescription = text;
            
            // Send upload status
            const statusMsg = await bot.sendMessage(chatId, '📤 Uploading file... 0%');
            
            try {
                // Create form data for file upload
                const formData = new FormData();
                formData.append('file', state.fileBuffer, state.fileName);
                formData.append('subjectId', state.selectedSubject._id);
                formData.append('type', state.contentType);
                formData.append('title', state.fileTitle);
                formData.append('description', fileDescription);
                
                // Upload to backend with progress tracking
                const response = await axios.post(`${BACKEND_URL}/api/admin/content`, formData, {
                    headers: {
                        ...formData.getHeaders()
                    },
                    onUploadProgress: (progressEvent) => {
                        const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
                        bot.editMessageText(`📤 Uploading file... ${percentCompleted}%`, {
                            chat_id: chatId,
                            message_id: statusMsg.message_id
                        });
                    }
                });
                
                if (response.data.success) {
                    bot.editMessageText(
                        `✅ File uploaded successfully!\n\n` +
                        `Subject: ${state.selectedSubject.name}\n` +
                        `File: ${state.fileTitle}\n` +
                        `Type: ${state.contentType}`,
                        {
                            chat_id: chatId,
                            message_id: statusMsg.message_id
                        }
                    );
                } else {
                    bot.editMessageText('❌ Failed to upload file', {
                        chat_id: chatId,
                        message_id: statusMsg.message_id
                    });
                }
            } catch (error) {
                bot.editMessageText('❌ Failed to upload file', {
                    chat_id: chatId,
                    message_id: statusMsg.message_id
                });
            }
            
            userStates.delete(chatId);
        }
    } catch (error) {
        console.error('File upload flow error:', error);
        bot.sendMessage(chatId, '❌ An error occurred during file upload');
        userStates.delete(chatId);
    }
});

console.log('🤖 Mechanical Aspirants Telegram Bot is running...');