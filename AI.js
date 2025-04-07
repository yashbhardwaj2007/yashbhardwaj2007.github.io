document.addEventListener('DOMContentLoaded', () => {
    // Check authentication
    const token = sessionStorage.getItem('authToken') || localStorage.getItem('authToken');
    if (!token) {
        window.location.replace('index.html');
        return;
    }

    // Initialize app
    initDarkMode();
    initParticles();
    setupEventListeners();
    initAuth();
    showQueryHistory();
    document.getElementById('query').focus();
});

const authState = {
    token: localStorage.getItem('authToken'),
    user: JSON.parse(localStorage.getItem('userData')) || null
};

const QUERY_HISTORY_KEY = 'ethicalShoppingQueryHistory';
const MAX_HISTORY_ITEMS = 10;

// Authentication functions
function initAuth() {
    updateAuthUI();
    document.getElementById('authButton').addEventListener('click', toggleAuthModal);
    
    if (authState.token) {
        fetchProfile().then(profile => {
            if (profile) {
                authState.user = profile;
                localStorage.setItem('userData', JSON.stringify(profile));
                updateAuthUI();
            }
        });
    }
}

async function login() {
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    
    if (!email || !password) {
        showAlert("Please fill in all fields");
        return;
    }
    
    showGlobalLoading();
    
    try {
        const response = await fetch('http://127.0.0.1:5000/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            authState.token = data.access_token;
            localStorage.setItem('authToken', data.access_token);
            const profile = await fetchProfile();
            authState.user = profile;
            localStorage.setItem('userData', JSON.stringify(profile));
            toggleAuthModal();
            updateAuthUI();
            showAlert("Login successful!", "success");
        } else {
            showAlert(data.error || 'Login failed');
        }
    } catch (error) {
        showAlert('Network error. Please try again.');
    } finally {
        hideGlobalLoading();
    }
}

async function register() {
    const name = document.getElementById('registerName').value;
    const email = document.getElementById('registerEmail').value;
    const password = document.getElementById('registerPassword').value;
    
    if (!name || !email || !password) {
        showAlert("Please fill in all fields");
        return;
    }
    
    showGlobalLoading();
    
    try {
        const response = await fetch('http://127.0.0.1:5000/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, name })
        });
        
        if (response.ok) {
            showAlert('Registration successful! Please login.', "success");
            showLoginForm();
            document.getElementById('registerName').value = '';
            document.getElementById('registerEmail').value = '';
            document.getElementById('registerPassword').value = '';
        } else {
            const data = await response.json();
            showAlert(data.error || 'Registration failed');
        }
    } catch (error) {
        showAlert('Network error. Please try again.');
    } finally {
        hideGlobalLoading();
    }
}

async function fetchProfile() {
    try {
        const response = await fetch('http://127.0.0.1:5000/profile', {
            headers: { 'Authorization': `Bearer ${authState.token}` }
        });
        return response.ok ? await response.json() : null;
    } catch (error) {
        return null;
    }
}

function updateAuthUI() {
    const authButton = document.getElementById('authButton');
    if (authState.user) {
        authButton.innerHTML = `<i class="fas fa-user-check"></i>`;
        authButton.title = `Logged in as ${authState.user.name}`;
    } else {
        authButton.innerHTML = `<i class="fas fa-user"></i>`;
        authButton.title = 'Login/Register';
    }
}

// Search functionality
async function searchBrands() {
    const query = document.getElementById("query").value.trim();
    if (!query) {
        showAlert("Please enter a product type.");
        return;
    }
    
    saveQueryToHistory(query);
    
    const button = document.getElementById('searchButton');
    const spinner = document.getElementById('searchSpinner');
    const text = document.getElementById('searchText');
    
    text.style.display = 'none';
    spinner.style.display = 'inline-block';
    showLoadingState();
    showGlobalLoading();
    
    try {
        const response = await fetch("http://127.0.0.1:5000/search", {
            method: "POST",
            headers: { 
                "Content-Type": "application/json",
                "Authorization": authState.token ? `Bearer ${authState.token}` : ""
            },
            body: JSON.stringify({ query: sanitizeInput(query) })
        });
        
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        
        const data = await response.json();
        displayResults(data);
        
    } catch (error) {
        console.error("Error:", error);
        showError("Sorry, we couldn't process your request. Please try again later.");
    } finally {
        text.style.display = 'inline-block';
        spinner.style.display = 'none';
        hideLoadingState();
        hideGlobalLoading();
    }
}

function displayResults(data) {
    const popup = document.createElement('div');
    popup.className = 'result-popup';
    
    let resultHtml = `
        <div class="popup-content">
            <span class="close-popup">&times;</span>
            <div class="result-title">
                <i class="fas fa-seedling"></i> Your Ethical Recommendations
            </div>
            <div class="result-content">`;
    
    // Parse the AI response into categories and brands
    const recommendations = parseAIResponse(data.recommendations);
    
    // Create HTML for each category
    for (const [category, brands] of Object.entries(recommendations)) {
        resultHtml += `
            <div class="brand-category">
                <h3><i class="fas fa-tag"></i> ${sanitizeInput(category)}</h3>
                <div class="brand-list">
                    ${brands.map(brand => `<span class="brand-tag">${sanitizeInput(brand)}</span>`).join('')}
                </div>
            </div>`;
    }
    
    resultHtml += `</div></div>`;
    popup.innerHTML = resultHtml;
    
    document.body.appendChild(popup);
    
    // Close popup when clicking X or outside
    document.querySelector('.close-popup').addEventListener('click', () => {
        popup.remove();
    });
    
    popup.addEventListener('click', (e) => {
        if (e.target === popup) popup.remove();
    });
}

function parseAIResponse(response) {
    const recommendations = {};
    const lines = response.split('\n');
    let currentCategory = '';
    
    for (const line of lines) {
        // Check for category line (e.g., "Fair Labor Practices")
        if (line.trim() && !line.startsWith('•') && !line.startsWith('-')) {
            currentCategory = line.trim();
            recommendations[currentCategory] = [];
        } 
        // Check for brand line (e.g., "• Nisolo")
        else if (currentCategory && (line.startsWith('•') || line.startsWith('-'))) {
            const brand = line.replace(/^[•-]\s*/, '').trim();
            if (brand) {
                recommendations[currentCategory].push(brand);
            }
        }
    }
    
    return recommendations;
}

// Chat functionality
async function chatWithAI() {
    const chatInput = document.getElementById("chatInput");
    const message = chatInput.value.trim();
    
    if (!message) {
        showAlert("Please enter your question.");
        return;
    }
    
    const chatBox = document.getElementById("chatBox");
    
    // Add user message to chat
    addMessageToChat('user', message);
    
    // Show typing indicator
    const typingId = showTypingIndicator();
    
    try {
        // Get chat history
        const history = getChatHistory();
        
        const response = await fetch("http://127.0.0.1:5000/chat", {
            method: "POST",
            headers: { 
                "Content-Type": "application/json",
                "Authorization": authState.token ? `Bearer ${authState.token}` : ""
            },
            body: JSON.stringify({ 
                message: sanitizeInput(message),
                history: history
            })
        });
        
        removeTypingIndicator(typingId);
        
        if (!response.ok) throw new Error('Chat response failed');
        
        const data = await response.json();
        addMessageToChat('assistant', data.response);
        
    } catch (error) {
        console.error("Error:", error);
        removeTypingIndicator(typingId);
        addMessageToChat('assistant', "I apologize, I'm having technical difficulties. Please try again later.");
    }
    
    chatInput.value = "";
    chatInput.style.height = "auto";
    chatBox.scrollTop = chatBox.scrollHeight;
}

// Helper functions for chat
function getChatHistory() {
    const messages = document.querySelectorAll('.message');
    const history = [];
    
    messages.forEach(msg => {
        const isUser = msg.classList.contains('user-message');
        const content = msg.querySelector('.message-content').textContent;
        
        history.push({
            sender: isUser ? 'user' : 'assistant',
            content: content
        });
    });
    
    return history;
}

function addMessageToChat(sender, content) {
    const chatBox = document.getElementById("chatBox");
    const messageClass = sender === 'user' ? 'user-message' : 'bot-message';
    const senderName = sender === 'user' ? 'You' : 'AI Assistant';
    
    chatBox.innerHTML += `
        <div class="message ${messageClass}">
            <div class="message-sender">${senderName}</div>
            <div class="message-content">${sanitizeInput(content.replace(/\n/g, '<br>'))}</div>
        </div>
    `;
    
    chatBox.scrollTop = chatBox.scrollHeight;
}

function showTypingIndicator() {
    const id = 'typing-' + Date.now();
    const chatBox = document.getElementById("chatBox");
    
    chatBox.innerHTML += `
        <div class="message bot-message" id="${id}">
            <div class="message-sender">AI Assistant</div>
            <div class="message-content typing">
                <span class="typing-dot"></span>
                <span class="typing-dot"></span>
                <span class="typing-dot"></span>
            </div>
        </div>
    `;
    
    chatBox.scrollTop = chatBox.scrollHeight;
    return id;
}

function removeTypingIndicator(id) {
    const indicator = document.getElementById(id);
    if (indicator) {
        indicator.remove();
    }
}
async function chatWithAI() {
    const chatInput = document.getElementById("chatInput");
    const message = chatInput.value.trim();
    
    if (!message) {
        showAlert("Please enter a question.");
        return;
    }
    
    const chatBox = document.getElementById("chatBox");
    chatBox.innerHTML += `
        <div class="message user-message">
            <div class="message-sender">You</div>
            <div class="message-content">${sanitizeInput(message.replace(/\n/g, '<br>'))}</div>
        </div>
    `;
    
    chatBox.innerHTML += `
        <div class="message bot-message">
            <div class="message-sender">AI Assistant</div>
            <div class="message-content typing">
                <span class="typing-dot"></span>
                <span class="typing-dot"></span>
                <span class="typing-dot"></span>
            </div>
        </div>
    `;
    
    chatBox.scrollTop = chatBox.scrollHeight;
    chatInput.value = "";
    chatInput.style.height = "auto";
    
    try {
        const response = await fetch("http://127.0.0.1:5000/chat", {
            method: "POST",
            headers: { 
                "Content-Type": "application/json",
                "Authorization": authState.token ? `Bearer ${authState.token}` : ""
            },
            body: JSON.stringify({ message: sanitizeInput(message) })
        });
        
        if (!response.ok) throw new Error('Chat response failed');
        
        const data = await response.json();
        
        document.querySelectorAll('.typing').forEach(indicator => indicator.parentElement.remove());
        
        chatBox.innerHTML += `
            <div class="message bot-message">
                <div class="message-sender">AI Assistant</div>
                <div class="message-content">${sanitizeInput(data.response || "I couldn't understand that. Could you rephrase your question?")}</div>
            </div>
        `;
        
    } catch (error) {
        console.error("Error:", error);
        document.querySelectorAll('.typing').forEach(indicator => indicator.parentElement.remove());
        
        chatBox.innerHTML += `
            <div class="message bot-message">
                <div class="message-sender">AI Assistant</div>
                <div class="message-content">Sorry, I'm having trouble connecting. Please try again later.</div>
            </div>
        `;
    }
    
    chatBox.scrollTop = chatBox.scrollHeight;
}

// UI Functions
function toggleAuthModal() {
    const modal = document.getElementById('authModal');
    modal.style.display = modal.style.display === 'block' ? 'none' : 'block';
    if (modal.style.display === 'block') showLoginForm();
}

function showLoginForm() {
    document.getElementById('loginForm').style.display = 'block';
    document.getElementById('registerForm').style.display = 'none';
}

function showRegisterForm() {
    document.getElementById('loginForm').style.display = 'none';
    document.getElementById('registerForm').style.display = 'block';
}

function toggleChatbot() {
    const chatbot = document.getElementById("chatbot");
    chatbot.classList.toggle('active');
    
    if (chatbot.classList.contains('active')) {
        setTimeout(() => document.getElementById("chatInput").focus(), 300);
    }
}

function toggleDarkMode() {
    document.body.classList.toggle('dark-mode');
    const icon = document.querySelector('#themeToggle i');
    icon.classList.toggle('fa-moon');
    icon.classList.toggle('fa-sun');
    localStorage.setItem('darkMode', document.body.classList.contains('dark-mode'));
}

function initDarkMode() {
    if (localStorage.getItem('darkMode') === 'true') {
        document.body.classList.add('dark-mode');
        const icon = document.querySelector('#themeToggle i');
        icon.classList.replace('fa-moon', 'fa-sun');
    }
}

// Utility Functions
function saveQueryToHistory(query) {
    let history = JSON.parse(localStorage.getItem(QUERY_HISTORY_KEY)) || [];
    history = history.filter(item => item.toLowerCase() !== query.toLowerCase());
    history.unshift(query);
    history = history.slice(0, MAX_HISTORY_ITEMS);
    localStorage.setItem(QUERY_HISTORY_KEY, JSON.stringify(history));
}

function showQueryHistory() {
    const history = JSON.parse(localStorage.getItem(QUERY_HISTORY_KEY)) || [];
    const datalist = document.getElementById('suggestions');
    datalist.innerHTML = '';
    
    history.forEach(query => {
        const option = document.createElement('option');
        option.value = query;
        datalist.appendChild(option);
    });
}

function showGlobalLoading() {
    document.getElementById('loadingOverlay').style.display = 'flex';
}

function hideGlobalLoading() {
    document.getElementById('loadingOverlay').style.display = 'none';
}

function showLoadingState() {
    document.getElementById('result').style.display = 'none';
    document.getElementById('loadingSkeleton').style.display = 'block';
}

function hideLoadingState() {
    document.getElementById('loadingSkeleton').style.display = 'none';
}

function showAlert(message, type = 'error') {
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert-message ${type}`;
    alertDiv.textContent = message;
    document.body.appendChild(alertDiv);
    
    setTimeout(() => {
        alertDiv.style.opacity = '0';
        setTimeout(() => alertDiv.remove(), 300);
    }, 3000);
}

function showError(message) {
    document.getElementById("result").style.display = "block";
    document.getElementById("resultContent").innerHTML = `
        <p>${sanitizeInput(message)}</p>
        <button onclick="searchBrands()" class="retry-button">Try Again</button>
    `;
}

function sanitizeInput(input) {
    const div = document.createElement('div');
    div.textContent = input;
    return div.innerHTML;
}

function logout() {
    sessionStorage.removeItem('authToken');
    localStorage.removeItem('authToken');
    window.location.href = 'index.html';
}

// Particle Background
function initParticles() {
    const canvas = document.getElementById('particle-canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    
    const colors = [
        {r: 106, g: 17, b: 203},
        {r: 37, g: 117, b: 252},
        {r: 151, g: 52, b: 227},
        {r: 84, g: 51, b: 255}
    ];
    
    const particles = [];
    const particleCount = Math.floor(window.innerWidth / 10);
    
    for (let i = 0; i < particleCount; i++) {
        particles.push({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height,
            size: Math.random() * 4 + 1,
            speedX: Math.random() * 2 - 1,
            speedY: Math.random() * 2 - 1,
            opacity: Math.random() * 0.3 + 0.1,
            color: `rgba(255, 255, 255, ${Math.random() * 0.3 + 0.1})`
        });
    }
    
    const shapes = [];
    const shapeCount = 8;
    
    for (let i = 0; i < shapeCount; i++) {
        shapes.push({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height,
            size: Math.random() * 150 + 50,
            speed: Math.random() * 0.2 + 0.1,
            angle: Math.random() * Math.PI * 2,
            rotation: Math.random() * 0.02 - 0.01,
            type: Math.random() > 0.5 ? 'circle' : 'square',
            opacity: Math.random() * 0.03 + 0.02
        });
    }
    
    function animate() {
        let colorIndex = 0;
        let gradientProgress = 0;
        
        gradientProgress += 0.002;
        if (gradientProgress >= 1) {
            gradientProgress = 0;
            colorIndex = (colorIndex + 1) % (colors.length - 1);
        }
        
        const startColor = colors[colorIndex];
        const endColor = colors[colorIndex + 1];
        
        const r = startColor.r + (endColor.r - startColor.r) * gradientProgress;
        const g = startColor.g + (endColor.g - startColor.g) * gradientProgress;
        const b = startColor.b + (endColor.b - startColor.b) * gradientProgress;
        
        const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
        gradient.addColorStop(0, `rgb(${r}, ${g}, ${b})`);
        gradient.addColorStop(1, `rgb(${r-20}, ${g+30}, ${b+50})`);
        
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        particles.forEach(particle => {
            ctx.fillStyle = particle.color;
            ctx.beginPath();
            ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
            ctx.fill();
            
            particle.x += particle.speedX;
            particle.y += particle.speedY;
            
            if (particle.x < 0 || particle.x > canvas.width) particle.speedX *= -1;
            if (particle.y < 0 || particle.y > canvas.height) particle.speedY *= -1;
            
            particle.size += Math.sin(Date.now() * 0.001 + particle.x) * 0.1;
            particle.size = Math.max(1, Math.min(5, particle.size));
        });
        
        shapes.forEach(shape => {
            ctx.save();
            ctx.translate(shape.x, shape.y);
            ctx.rotate(shape.angle);
            ctx.globalAlpha = shape.opacity;
            
            if (shape.type === 'circle') {
                ctx.beginPath();
                ctx.arc(0, 0, shape.size / 2, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
                ctx.fill();
            } else {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
                ctx.fillRect(-shape.size / 2, -shape.size / 2, shape.size, shape.size);
            }
            
            ctx.restore();
            
            shape.x += Math.cos(shape.angle) * shape.speed;
            shape.y += Math.sin(shape.angle) * shape.speed;
            shape.angle += shape.rotation;
            
            if (shape.x < -shape.size) shape.x = canvas.width + shape.size;
            if (shape.x > canvas.width + shape.size) shape.x = -shape.size;
            if (shape.y < -shape.size) shape.y = canvas.height + shape.size;
            if (shape.y > canvas.height + shape.size) shape.y = -shape.size;
        });
        
        requestAnimationFrame(animate);
    }
    
    animate();
    
    window.addEventListener('resize', () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    });
}

// Event Listeners
function setupEventListeners() {
    document.getElementById('themeToggle').addEventListener('click', toggleDarkMode);
    
    document.getElementById("query").addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            searchBrands();
        }
    });

    document.getElementById("chatInput").addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            chatWithAI();
        }
    });

    document.getElementById("chatInput").addEventListener("input", function() {
        this.style.height = "auto";
        this.style.height = (this.scrollHeight) + "px";
    });
    
    document.getElementById('logoutButton')?.addEventListener('click', logout);
}

// Profile functionality
function showProfile() {
    if (!authState.token) {
        showAlert("Please login to view your profile");
        return;
    }

    fetchProfileData();
    document.getElementById('profileSection').style.display = 'block';
}

function hideProfile() {
    document.getElementById('profileSection').style.display = 'none';
}

async function fetchProfileData() {
    try {
        const response = await fetch('http://127.0.0.1:5000/profile/data', {
            headers: { 'Authorization': `Bearer ${authState.token}` }
        });
        
        if (response.ok) {
            const data = await response.json();
            displayProfileData(data);
        }
    } catch (error) {
        console.error("Error fetching profile:", error);
    }
}

function displayProfileData(data) {
    document.getElementById('profileName').textContent = data.name;
    document.getElementById('profileEmail').textContent = data.email;
    document.getElementById('totalSearches').textContent = data.search_count;

    const historyList = document.getElementById('searchHistoryList');
    historyList.innerHTML = '';

    if (data.recent_searches && data.recent_searches.length > 0) {
        data.recent_searches.forEach(search => {
            const li = document.createElement('li');
            li.innerHTML = `
                <span>${search.query}</span>
                <span class="search-date">${new Date(search.timestamp).toLocaleString()}</span>
            `;
            historyList.appendChild(li);
        });
    } else {
        historyList.innerHTML = '<li>No search history yet</li>';
    }
}