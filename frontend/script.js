document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const uploadArea = document.getElementById('upload-area');
    const fileInput = document.getElementById('file-input');
    const uploadBtn = document.getElementById('upload-btn');
    const fileList = document.getElementById('file-list');
    const processingStatus = document.getElementById('processing-status');
    const statusIndicator = document.getElementById('status-indicator');
    const chatMessages = document.getElementById('chat-messages');
    const chatForm = document.getElementById('chat-form');
    const questionInput = document.getElementById('question-input');
    const sendBtn = document.getElementById('send-btn');
    const typingIndicator = document.getElementById('typing-indicator');

    // State
    let uploadedFiles = [];
    let currentFile = null;
    let isProcessing = false;
    let chatHistory = []; // Store chat history
    let systemInitialized = false;

    // Initialize
    initializeApp();

    // Upload Area Events
    uploadArea.addEventListener('click', () => fileInput.click());
    uploadArea.addEventListener('dragover', handleDragOver);
    uploadArea.addEventListener('dragleave', handleDragLeave);
    uploadArea.addEventListener('drop', handleDrop);

    fileInput.addEventListener('change', handleFileSelect);
    uploadBtn.addEventListener('click', handleUpload);

    // Chat Events
    chatForm.addEventListener('submit', handleChatSubmit);

    // Functions
    async function initializeApp() {
        updateStatusIndicator('initializing');
        
        try {
            // Initialize system
            const initResponse = await fetch('/api/initialize', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
            });
            
            const initResult = await initResponse.json();
            if (initResponse.ok) {
                systemInitialized = true;
                if (initResult.has_data) {
                    enableChat();
                    showNotification('System loaded with existing documents!', 'success');
                }
            }
            
            // Load existing files
            await loadExistingFiles();
            
            updateStatusIndicator('ready');
        } catch (error) {
            console.error('Initialization error:', error);
            updateStatusIndicator('error');
            showNotification('Failed to initialize system', 'error');
        }
    }

    async function loadExistingFiles() {
        try {
            const response = await fetch('/api/files');
            const result = await response.json();
            
            if (response.ok) {
                uploadedFiles = result.files.map(file => ({
                    id: Date.now() + Math.random(), // Generate unique ID
                    name: file.name,
                    size: formatFileSize(file.size),
                    uploadedAt: file.uploaded_at || 'Existing file',
                    isExisting: true
                }));
                updateFileList();
                
                if (uploadedFiles.length > 0) {
                    showNotification(`Loaded ${uploadedFiles.length} existing document(s)`, 'success');
                }
            }
        } catch (error) {
            console.error('Error loading existing files:', error);
        }
    }

    // Upload Area Events
    uploadArea.addEventListener('click', () => fileInput.click());
    uploadArea.addEventListener('dragover', handleDragOver);
    uploadArea.addEventListener('dragleave', handleDragLeave);
    uploadArea.addEventListener('drop', handleDrop);

    fileInput.addEventListener('change', handleFileSelect);
    uploadBtn.addEventListener('click', handleUpload);

    // Chat Events
    chatForm.addEventListener('submit', handleChatSubmit);

    // Functions
    function handleDragOver(e) {
        e.preventDefault();
        uploadArea.classList.add('dragover');
    }

    function handleDragLeave(e) {
        e.preventDefault();
        uploadArea.classList.remove('dragover');
    }

    function handleDrop(e) {
        e.preventDefault();
        uploadArea.classList.remove('dragover');
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            fileInput.files = files;
            handleFileSelect();
        }
    }

    function handleFileSelect() {
        const file = fileInput.files[0];
        if (file && file.type === 'application/pdf') {
            uploadBtn.disabled = false;
            updateStatusIndicator('file-selected');
        } else {
            uploadBtn.disabled = true;
            updateStatusIndicator('ready');
            if (file) {
                showNotification('Please select a PDF file only.', 'error');
            }
        }
    }

    async function handleUpload() {
        const file = fileInput.files[0];
        if (!file) return;

        isProcessing = true;
        updateStatusIndicator('processing');
        uploadBtn.disabled = true;
        processingStatus.style.display = 'block';

        const formData = new FormData();
        formData.append('file', file);

        try {
            const response = await fetch('/upload', {
                method: 'POST',
                body: formData,
            });

            const contentType = response.headers.get("content-type");
            if (contentType && contentType.indexOf("application/json") !== -1) {
                const result = await response.json();
                if (response.ok) {
                    // Add file to list
                    const fileInfo = {
                        id: Date.now(),
                        name: file.name,
                        size: formatFileSize(file.size),
                        uploadedAt: new Date().toLocaleTimeString()
                    };
                    uploadedFiles.push(fileInfo);
                    currentFile = fileInfo;
                    
                    updateFileList();
                    updateStatusIndicator('ready');
                    showNotification('Document processed successfully! You can now ask questions.', 'success');
                    
                    // Clear welcome message and enable chat
                    clearWelcomeMessage();
                    enableChat();
                } else {
                    throw new Error(result.error || 'Upload failed');
                }
            } else {
                 const textResponse = await response.text();
                throw new Error('Server error. Please check the backend console.');
            }
        } catch (error) {
            console.error('Upload error:', error);
            updateStatusIndicator('error');
            showNotification(`Upload failed: ${error.message}`, 'error');
        } finally {
            isProcessing = false;
            uploadBtn.disabled = true;
            processingStatus.style.display = 'none';
            fileInput.value = '';
        }
    }

    async function handleChatSubmit(e) {
        e.preventDefault();
        
        const question = questionInput.value.trim();
        if (!question || isProcessing) return;

        // Add user message
        addMessage(question, 'user');
        questionInput.value = '';
        
        // Show typing indicator
        showTypingIndicator();
        sendBtn.disabled = true;

        try {
            const response = await fetch('/ask', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ question: question }),
            });

            const contentType = response.headers.get("content-type");
            if (contentType && contentType.indexOf("application/json") !== -1) {
            const result = await response.json();
            
            if (response.ok) {
                    addMessage(result.answer, 'bot');
                } else {
                    throw new Error(result.error || 'Failed to get answer');
                }
            } else {
                throw new Error('Server error. Please check the backend console.');
            }
        } catch (error) {
            console.error('Chat error:', error);
            addMessage(`Sorry, an error occurred: ${error.message}`, 'bot');
        } finally {
            hideTypingIndicator();
            sendBtn.disabled = false;
            questionInput.focus();
        }
    }

    function addMessage(text, sender) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${sender}`;
        
        const avatar = document.createElement('div');
        avatar.className = 'message-avatar';
        avatar.innerHTML = sender === 'user' ? '<i class="fas fa-user"></i>' : '<i class="fas fa-robot"></i>';
        
        const content = document.createElement('div');
        content.className = 'message-content';
        content.textContent = text;
        
        messageDiv.appendChild(avatar);
        messageDiv.appendChild(content);
        
        chatMessages.appendChild(messageDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
        
        // Store in chat history
        chatHistory.push({
            text: text,
            sender: sender,
            timestamp: new Date().toISOString()
        });
    }

    function showTypingIndicator() {
        typingIndicator.style.display = 'flex';
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    function hideTypingIndicator() {
        typingIndicator.style.display = 'none';
    }

    function clearWelcomeMessage() {
        const welcomeMessage = chatMessages.querySelector('.welcome-message');
        if (welcomeMessage) {
            welcomeMessage.remove();
        }
    }

    function restoreChatHistory() {
        // Clear current messages
        chatMessages.innerHTML = '';
        
        // Restore chat history
        if (chatHistory.length > 0) {
            chatHistory.forEach(msg => {
                const messageDiv = document.createElement('div');
                messageDiv.className = `message ${msg.sender}`;
                
                const avatar = document.createElement('div');
                avatar.className = 'message-avatar';
                avatar.innerHTML = msg.sender === 'user' ? '<i class="fas fa-user"></i>' : '<i class="fas fa-robot"></i>';
                
                const content = document.createElement('div');
                content.className = 'message-content';
                content.textContent = msg.text;
                
                messageDiv.appendChild(avatar);
                messageDiv.appendChild(content);
                chatMessages.appendChild(messageDiv);
            });
            chatMessages.scrollTop = chatMessages.scrollHeight;
        } else {
            showWelcomeMessage();
        }
    }

    function enableChat() {
        questionInput.disabled = false;
        sendBtn.disabled = false;
        questionInput.focus();
    }

    function updateFileList() {
        if (uploadedFiles.length === 0) {
            fileList.innerHTML = `
                <div class="no-files">
                    <i class="fas fa-file-pdf"></i>
                    <p>No documents uploaded yet</p>
                </div>
            `;
        } else {
            fileList.innerHTML = uploadedFiles.map(file => `
                <div class="file-item">
                    <div class="file-info">
                        <i class="fas fa-file-pdf file-icon"></i>
                        <div class="file-details">
                            <h4>${file.name}</h4>
                            <p>${file.size} • ${file.uploadedAt}</p>
                        </div>
                    </div>
                    <button class="delete-btn" onclick="deleteFile(${file.id})">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            `).join('');
        }
    }

    async function deleteFile(fileId) {
        const fileIndex = uploadedFiles.findIndex(f => f.id === fileId);
        if (fileIndex !== -1) {
            const file = uploadedFiles[fileIndex];
            
            try {
                const response = await fetch('/delete', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ filename: file.name }),
                });

                const result = await response.json();
                
                if (response.ok) {
                    uploadedFiles.splice(fileIndex, 1);
                    updateFileList();
                    
                    // Check if this was the current active file
                    if (currentFile && currentFile.id === fileId) {
                        currentFile = null;
                        
                        // Check if there are still files available
                        if (uploadedFiles.length > 0) {
                            // Keep chat enabled if other files exist
                            showNotification('File deleted. Chat remains active with other documents.', 'success');
                        } else {
                            // No files left, but preserve chat history
                            disableChat();
                            restoreChatHistory();
                            updateStatusIndicator('ready');
                            showNotification('File deleted. Chat history preserved.', 'success');
                        }
                    } else {
                        showNotification('File deleted successfully.', 'success');
                    }
                } else {
                    throw new Error(result.error || 'Failed to delete file');
                }
            } catch (error) {
                console.error('Delete error:', error);
                showNotification(`Failed to delete file: ${error.message}`, 'error');
            }
        }
    }

    function disableChat() {
        questionInput.disabled = true;
        sendBtn.disabled = true;
        questionInput.value = '';
    }

    function showWelcomeMessage() {
        chatMessages.innerHTML = `
            <div class="welcome-message">
                <div class="welcome-content">
                    <i class="fas fa-robot"></i>
                    <h3>Welcome to RAG Chatbot!</h3>
                    <p>Upload a PDF document to start asking questions about its content.</p>
                </div>
            </div>
        `;
    }

    function updateStatusIndicator(status) {
        const indicator = statusIndicator.querySelector('i');
        const text = statusIndicator.querySelector('span');
        
        switch (status) {
            case 'ready':
                indicator.style.color = '#4ade80';
                text.textContent = 'Ready';
                break;
            case 'initializing':
                indicator.style.color = '#3b82f6';
                text.textContent = 'Initializing';
                break;
            case 'file-selected':
                indicator.style.color = '#f59e0b';
                text.textContent = 'File Selected';
                break;
            case 'processing':
                indicator.style.color = '#3b82f6';
                text.textContent = 'Processing';
                break;
            case 'error':
                indicator.style.color = '#ef4444';
                text.textContent = 'Error';
                break;
        }
    }

    function formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    function showNotification(message, type) {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        
        // Style the notification
        Object.assign(notification.style, {
            position: 'fixed',
            top: '20px',
            right: '20px',
            padding: '1rem 1.5rem',
            borderRadius: '10px',
            color: 'white',
            fontWeight: '500',
            zIndex: '1000',
            transform: 'translateX(100%)',
            transition: 'transform 0.3s ease',
            maxWidth: '300px',
            wordWrap: 'break-word'
        });

        if (type === 'success') {
            notification.style.background = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
        } else if (type === 'error') {
            notification.style.background = 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)';
        }

        document.body.appendChild(notification);

        // Animate in
        setTimeout(() => {
            notification.style.transform = 'translateX(0)';
        }, 100);

        // Remove after 3 seconds
        setTimeout(() => {
            notification.style.transform = 'translateX(100%)';
            setTimeout(() => {
                document.body.removeChild(notification);
            }, 300);
        }, 3000);
    }

    // Make deleteFile globally accessible
    window.deleteFile = deleteFile;
});

