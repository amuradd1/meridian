FROM python:3.12-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application files
COPY . .

# Generate initial data placeholder (LLM call happens at runtime)
RUN echo '{"status":"generating","message":"Intelligence data is being generated. Please wait..."}' > data.json

# Expose port (Railway injects PORT env var)
EXPOSE 8000

# Start the application
CMD ["python", "start.py"]
