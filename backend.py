from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
import google.generativeai as genai
import os
from dotenv import load_dotenv
from functools import wraps
import logging
import re
from datetime import datetime, timedelta
from flask_jwt_extended import (
    JWTManager, create_access_token, jwt_required, get_jwt_identity, get_jwt
)

# Load environment variables
load_dotenv(dotenv_path=".env")

# Initialize Flask app
app = Flask(__name__)
CORS(app)

# Configuration
app.config["JWT_SECRET_KEY"] = os.getenv("JWT_SECRET", "super-secret-key")
app.config["JWT_ACCESS_TOKEN_EXPIRES"] = timedelta(days=7)
jwt = JWTManager(app)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Mock database
users = {
    "test@example.com": {
        "password": "password123",
        "name": "Test User",
        "search_history": [],
        "search_count": 0
    }
}

# Initialize Gemini AI
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    logger.error("❌ Google Gemini API key is missing!")
    raise ValueError("Google Gemini API key is missing!")

genai.configure(api_key=GEMINI_API_KEY)

# Utility Functions
def handle_errors(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        try:
            return f(*args, **kwargs)
        except Exception as e:
            logger.error(f"Error in {f.__name__}: {str(e)}", exc_info=True)
            return jsonify({"error": "An unexpected error occurred"}), 500
    return wrapper

def validate_json_request():
    if not request.is_json:
        return jsonify({"error": "Request must be JSON"}), 415
    return None

def validate_required_fields(data, required_fields):
    missing = [field for field in required_fields if field not in data]
    if missing:
        return jsonify({"error": f"Missing required fields: {', '.join(missing)}"}), 400
    return None

def parse_ai_response(ai_response):
    """Parse AI response into structured data"""
    recommendations = {}
    current_category = None
    lines = [line.strip() for line in ai_response.split('\n') if line.strip()]
    
    for line in lines:
        if line.lower().startswith('category:'):
            current_category = line.split(':', 1)[1].strip()
            recommendations[current_category] = []
        elif line.startswith('-') and current_category:
            brand = line[1:].strip()
            if brand:  # Only add if brand name exists
                recommendations[current_category].append(brand)
    
    return recommendations

# Routes
@app.route('/')
@jwt_required(optional=True)
def home():
    if get_jwt_identity():
        return send_file('AI.html')
    return send_file('index.html')

@app.route("/search", methods=["POST"])
@jwt_required()
@handle_errors
def search():
    if error := validate_json_request():
        return error
        
    data = request.get_json()
    if error := validate_required_fields(data, ["query"]):
        return error
        
    product = data.get("query", "").strip().lower()
    if not product:
        return jsonify({"error": "Empty query"}), 400

    current_user = get_jwt_identity()
    
    try:
        model = genai.GenerativeModel("gemini-1.5-flash")
        prompt = f"""Provide 3-5 ethical brands for {product} in this exact format:
        
        Category: [Category Name]
        - Brand1
        - Brand2
        - Brand3
        
        Only include brand names (no descriptions).
        Return maximum 3 categories.
        Example for shoes:
        
        Category: Sustainable Materials
        - Allbirds
        - Veja
        - Rothy's
        
        Category: Fair Labor
        - Nisolo
        - Patagonia"""

        response = model.generate_content(prompt)
        
        if not response or not hasattr(response, "candidates"):
            return jsonify({"error": "API response format invalid"}), 500

        ai_response = response.candidates[0].content.parts[0].text.strip()
        recommendations = parse_ai_response(ai_response)
        
        if not recommendations:
            return jsonify({"error": "No brands found for this product"}), 404

        return jsonify({
            "product": product,
            "recommendations": recommendations,
            "authenticated": current_user is not None
        })

    except Exception as e:
        logger.error(f"Search error: {str(e)}")
        return jsonify({"error": "Failed to get recommendations. Please try again."}), 500

@app.route('/chat', methods=['POST'])
@jwt_required(optional=True)
@handle_errors
def chat():
    data = request.get_json()
    if error := validate_json_request():
        return error
        
    user_message = data.get("message", "").strip()
    if not user_message:
        return jsonify({"error": "Empty message"}), 400

    try:
        model = genai.GenerativeModel('gemini-1.5-flash')
        prompt = f"""As a professional ethical shopping assistant, respond to this query:
        
        "{user_message}"
        
        Guidelines:
        - Be polite and helpful
        - Recommend specific brands when appropriate
        - Keep responses under 3 sentences
        - For product queries, suggest 2-3 ethical brands"""
        
        response = model.generate_content(prompt)
        
        if not response or not hasattr(response, "candidates"):
            return jsonify({"response": "Let me check that for you..."}), 500

        return jsonify({
            "response": response.candidates[0].content.parts[0].text.strip(),
            "authenticated": get_jwt_identity() is not None
        })

    except Exception as e:
        logger.error(f"Chat error: {str(e)}")
        return jsonify({"response": "I'm having trouble responding. Please try again later."}), 500
@app.route('/chat', methods=['POST'])
@jwt_required(optional=True)
@handle_errors
def chat():
    """Handle chatbot queries"""
    if error := validate_json_request():
        return error
        
    data = request.get_json()
    if error := validate_required_fields(data, ["message"]):
        return error
        
    user_message = data.get("message", "").strip()
    chat_history = data.get("history", [])
    current_user = get_jwt_identity()

    if not user_message:
        return jsonify({"error": "Empty message"}), 400

    try:
        model = genai.GenerativeModel('gemini-1.5-flash')
        
        prompt = f"""You are a professional, polite ethical shopping assistant. Your responses should:
        1. Be friendly and helpful
        2. Maintain professional tone
        3. Provide accurate brand recommendations when asked
        4. Keep responses concise but informative
        
        Current conversation history:
        {format_chat_history(chat_history)}
        
        User's new message: {user_message}
        
        Please respond professionally and helpfully:"""

        response = model.generate_content(prompt)

        if not response or not hasattr(response, "candidates"):
            return jsonify({"response": "I apologize, I'm having trouble responding right now."}), 500

        cleaned_response = clean_chat_response(response.candidates[0].content.parts[0].text.strip())
        
        return jsonify({
            "response": cleaned_response,
            "authenticated": current_user is not None
        })

    except Exception as e:
        logger.error(f"Chat error: {str(e)}")
        return jsonify({"response": "I apologize for the inconvenience. I'm currently unable to process your request."}), 500

@app.route('/register', methods=['POST'])
@handle_errors
def register():
    """Handle user registration"""
    if error := validate_json_request():
        return error
        
    data = request.get_json()
    if error := validate_required_fields(data, ["email", "password", "name"]):
        return error
        
    email = data['email']
    password = data['password']
    name = data['name']

    if email in users:
        return jsonify({"error": "Email already exists"}), 400

    users[email] = {
        "password": password,
        "name": name,
        "search_history": [],
        "search_count": 0
    }

    logger.info(f"New user registered: {email}")
    return jsonify({"message": "Registration successful"}), 201

@app.route('/login', methods=['POST'])
@handle_errors
def login():
    """Handle user login"""
    if error := validate_json_request():
        return error
        
    data = request.get_json()
    if error := validate_required_fields(data, ["email", "password"]):
        return error
        
    email = data['email']
    password = data['password']

    user = users.get(email)
    if not user or user['password'] != password:
        return jsonify({"error": "Invalid credentials"}), 401

    access_token = create_access_token(
        identity=email,
        expires_delta=timedelta(hours=4)
    )
    
    return jsonify({
        "access_token": access_token,
        "message": "Login successful"
    }), 200

@app.route('/logout', methods=['POST'])
@jwt_required()
@handle_errors
def logout():
    """Handle user logout"""
    jti = get_jwt()['jti']
    blacklisted_tokens.add(jti)
    return jsonify({"message": "Logged out successfully"}), 200

@app.route('/profile', methods=['GET'])
@jwt_required()
@handle_errors
def profile():
    """Get user profile"""
    current_user = get_jwt_identity()
    user = users.get(current_user)
    
    if not user:
        return jsonify({"error": "User not found"}), 404
        
    return jsonify({
        "email": current_user,
        "name": user['name'],
        "search_history": user.get('search_history', [])
    }), 200

@app.route('/profile/data', methods=['GET'])
@jwt_required()
@handle_errors
def profile_data():
    """Get user profile data for UI"""
    current_user = get_jwt_identity()
    user = users.get(current_user)
    
    if not user:
        return jsonify({"error": "User not found"}), 404
        
    return jsonify({
        "name": user["name"],
        "email": current_user,
        "search_count": user["search_count"],
        "recent_searches": user["search_history"][-5:]
    })

@app.route('/health', methods=['GET'])
@handle_errors
def health_check():
    """Service health check"""
    return jsonify({
        "status": "healthy",
        "service": "ethical-shopping-assistant",
        "timestamp": datetime.now().isoformat()
    })

# Middleware
@app.after_request
def add_header(response):
    """Add security headers to all responses"""
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate'
    response.headers['Pragma'] = 'no-cache'
    return response

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=os.getenv("FLASK_DEBUG", "false").lower() == "true")