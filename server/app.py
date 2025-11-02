from flask import Flask, request, jsonify
from flask_cors import CORS
import sys
import os
from pathlib import Path
import json
import tempfile

# Add the brain directory to the path so we can  import find_best_meeting
# Get the project root directory (parent of server directory)
project_root = Path(__file__).parent.parent
brain_dir = project_root / "brain"

# Add brain directory to Python path so we can import find_best_meeting
sys.path.insert(0, str(brain_dir))

# Change working directory to brain directory so relative paths work
os.chdir(brain_dir)

from find_best_meeting import find_best_meeting

app = Flask(__name__)
# Configure CORS to allow all origins for development
# Try simplest configuration first - allows all origins and methods
CORS(app)

# Add explicit OPTIONS handler as fallback
@app.before_request
def handle_preflight():
    if request.method == "OPTIONS":
        response = jsonify({})
        response.headers.add("Access-Control-Allow-Origin", "*")
        response.headers.add("Access-Control-Allow-Headers", "Content-Type, Authorization")
        response.headers.add("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        return response

@app.route('/api/optimize', methods=['POST'])
def optimize():
    """
    Endpoint to run the meeting optimization.
    Expects JSON body with:
    - attendees: dict of city names to attendee counts
    - availability_window: dict with start and end timestamps
    - event_duration: dict with days and hours
    - weight_co2: float (optional, default 0.5)
    - weight_avg_vs_std: float (optional, default 1.0)
    """
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({"error": "No JSON data provided"}), 400
        
        # Validate required fields
        if "attendees" not in data:
            return jsonify({"error": "Missing 'attendees' field"}), 400
        if "availability_window" not in data:
            return jsonify({"error": "Missing 'availability_window' field"}), 400
        if "event_duration" not in data:
            return jsonify({"error": "Missing 'event_duration' field"}), 400
        
        # Get optional weights, default to 0.5 and 1.0
        weight_co2 = data.get("weight_co2", 0.5)
        weight_avg_vs_std = data.get("weight_avg_vs_std", 1.0)
        
        # Create a temporary JSON file in the brain directory for the Python function
        # Use absolute path to ensure find_best_meeting can find it
        temp_fd, temp_file_path = tempfile.mkstemp(suffix='.json', dir=str(brain_dir))
        os.close(temp_fd)  # Close the file descriptor, we'll open it properly below
        
        try:
            with open(temp_file_path, 'w') as f:
                json.dump(data, f)
            
            # Call the Python optimization function
            # Pass the absolute path - find_best_meeting can handle absolute paths
            # The function uses Path() which handles both absolute and relative paths
            results = find_best_meeting(temp_file_path, weight_co2, weight_avg_vs_std)
            
            # Clean up temporary file
            if os.path.exists(temp_file_path):
                os.unlink(temp_file_path)
            
            return jsonify(results), 200
            
        except Exception as e:
            # Clean up temporary file on error
            if os.path.exists(temp_file_path):
                os.unlink(temp_file_path)
            raise e
            
    except Exception as e:
        error_message = str(e)
        print(f"Error in optimize endpoint: {error_message}")
        return jsonify({"error": error_message}), 500

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({"status": "ok"}), 200

if __name__ == '__main__':
    # Run on port 5001 (changed from 5000 to avoid conflicts)
    app.run(host='0.0.0.0', port=5001, debug=True)

