from flask import Flask, jsonify, request
from flask_cors import CORS

app = Flask(__name__)
CORS(app)  # Allows your HTML frontend to talk to this backend

# A GET route to send data to the frontend
@app.route('/api/data', methods=['GET'])
def get_data():
    sample_data = {"message": "Hello from the Python backend!", "status": "success"}
    return jsonify(sample_data)

# A POST route to receive data from the frontend
@app.route('/api/send', methods=['POST'])
def receive_data():
    user_input = request.json.get('userInput')
    response_message = f"Python received your message: {user_input}"
    return jsonify({"reply": response_message})

if __name__ == '__main__':
    app.run(debug=True, port=5000)
