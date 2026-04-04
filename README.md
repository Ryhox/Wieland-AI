# Wieland-AI

<div align="center">

[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js->=18-green.svg)](https://nodejs.org/)
[![React](https://img.shields.io/badge/React-19-blue.svg)](https://react.dev)
[![Express](https://img.shields.io/badge/Express-5.2-black.svg)](https://expressjs.com/)
[![SQLite](https://img.shields.io/badge/SQLite-Latest-blue.svg)](https://www.sqlite.org/)
[![Status](https://img.shields.io/badge/Status-Active-brightgreen.svg)](#)

**Wieland-AI** is a full-featured, locally hosted AI chat assistant powered by [Ollama](https://ollama.com). Built with React, Express, and SQLite, it provides a complete solution for offline AI interactions with text and image support, user authentication, chat history, and admin dashboards.

[Features](#features) • [Tech Stack](#tech-stack) • [Installation](#installation) • [Usage](#usage) • [Configuration](#configuration) • [Contributing](#contributing)

</div>

---

## 🎯 Features

- **🔐 User Authentication** - Secure JWT-based authentication with bcrypt password hashing
- **💬 AI Chat Interface** - Interactive chat with live streaming responses
- **🖼️ Image Support** - Upload and process images with vision-capable models
- **📝 Chat History** - Persistent chat storage with automatic and manual titles
- **🎯 Intent Recognition** - Automatic intent detection and memory management using NLU
- **🌍 Multilingual Support** - Built-in i18n support (English, German, Italian)
- **📊 Admin Dashboard** - Comprehensive dashboard for user management and analytics
- **💳 Payment Integration** - Support for payment processing and subscription management
- **🗄️ Data Export** - Download chat history and data exports
- **📱 Responsive Design** - Mobile-friendly interface with modern UI
- **🛡️ Privacy First** - Runs locally with no cloud dependencies
- **⚡ Multiple AI Models** - Support for multiple Ollama models

---

## 🏗️ Tech Stack

### Frontend
- **React 19** - Modern UI library with hooks
- **Vite** - Lightning-fast build tool
- **React Router** - Client-side routing
- **i18next** - Internationalization framework
- **Three.js** - 3D graphics and visualizations
- **GSAP** - Animation library
- **Recharts** - Data visualization
- **Multer** - File upload handling

### Backend
- **Express.js 5.2** - Web framework
- **Node.js >= 18** - Runtime environment
- **SQLite 3** - Database with async/await support
- **JWT** - Token-based authentication
- **Bcrypt** - Password hashing
- **CORS** - Cross-origin resource sharing

### Development Tools
- **ESLint** - Code quality
- **Concurrently** - Run multiple processes
- **Nodemon** - Auto-reload during development
- **Archiver** - Data backup and export

---

## 📋 Prerequisites

- **Node.js** >= 18.x
- **npm** or **yarn** package manager
- **[Ollama](https://ollama.com)** - Running locally (default: `http://localhost:11434`)
- **SQLite** - Included with Node.js

---

## ⚙️ Installation

### 1. Clone the Repository
```bash
git clone https://github.com/yourusername/wieland-ai.git
cd wieland-ai
```

### 2. Install Frontend Dependencies
```bash
npm install
```

### 3. Install Backend Dependencies
```bash
npm run server:install
```

### 4. Configure Environment Variables
Create a `.env` file in the root directory:
```env
# Server Configuration
PORT=3001
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_KEEP_ALIVE=30m

# Authentication
JWT_SECRET=your_super_secret_jwt_key_change_this_in_production
JWT_EXPIRES=7d
BCRYPT_ROUNDS=12

# Database
SQLITE_PATH=./server/data/wieland.sqlite

# AI Model Configuration
INTENT_NLU_ENABLED=true
INTENT_NLU_DEBUG=false
INTENT_NLU_MODEL=qwen3-vl:2b-instruct
INTENT_NLU_TIMEOUT_MS=2800
INTENT_NLU_MAX_MESSAGE_CHARS=520
INTENT_NLU_MAX_MEMORY_ITEMS=3

# Ollama Prewarming (Optional)
OLLAMA_STARTUP_PREWARM=true
OLLAMA_PREWARM_TIMEOUT_MS=90000
OLLAMA_STARTUP_PREWARM_DELAY_MS=0
OLLAMA_STARTUP_PREWARM_MODELS=qwen3-vl:4b-instruct,qwen3-vl:2b-instruct
```

### 5. Ensure Ollama is Running
```bash
ollama serve
```

### 6. Start Development Server
```bash
npm run dev
```

This will start both frontend (Vite on port 5173) and backend (Express on port 3001) concurrently.

---

## 🚀 Usage

### Development
```bash
# Start both frontend and backend
npm run dev

# Start only frontend
npm run dev:frontend

# Start only backend
npm run dev:backend

# Build for production
npm build

# Preview production build
npm run preview

# Run linter
npm run lint
```

### Production
```bash
# Start the application
npm start

# Access the app
# Frontend: http://localhost:5173
# Backend API: http://localhost:3001
```

---

## 📁 Project Structure

```
wieland-ai/
├── src/                           # Frontend React application
│   ├── components/               # React components
│   │   ├── ChatInterface.jsx     # Main chat component
│   │   ├── Header.jsx            # Navigation header
│   │   ├── Sidebar.jsx           # Chat sidebar
│   │   ├── AuthModal.jsx         # Authentication modal
│   │   ├── dashboard/            # Admin dashboard components
│   │   │   ├── UsersTable.jsx
│   │   │   ├── ChatsTable.jsx
│   │   │   ├── ChatViewer.jsx
│   │   │   └── ActivityChart.jsx
│   │   └── ...
│   ├── pages/                    # Page components
│   │   ├── ChatPage.jsx          # Main chat page
│   │   ├── Dashboard.jsx         # Admin dashboard
│   │   ├── Profile.jsx           # User profile
│   │   ├── Pricing.jsx           # Pricing page
│   │   └── ...
│   ├── context/                  # React context
│   │   └── AuthContext.jsx       # Authentication context
│   ├── locales/                  # i18n translations
│   │   ├── en.json
│   │   ├── de.json
│   │   └── it.json
│   ├── styles/                   # CSS modules
│   └── utils/                    # Utility functions
├── server/                        # Backend Express application
│   ├── server.js                 # Main server file
│   ├── data/                     # SQLite database
│   ├── contacts/                 # Contact data
│   ├── history/                  # Chat history storage
│   └── scripts/                  # Utility scripts
├── wieland-extension/            # Browser extension
├── package.json                  # Frontend dependencies
└── vite.config.js               # Vite configuration
```

---

## 🔧 API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user
- `POST /api/auth/refresh` - Refresh JWT token
- `GET /api/auth/verify` - Verify token validity

### Chat
- `POST /api/chat` - Send chat message
- `GET /api/chats` - Get user's chat history
- `DELETE /api/chats/:id` - Delete chat
- `GET /api/chat/:id` - Get specific chat

### User Profile
- `GET /api/user/profile` - Get user profile
- `PUT /api/user/profile` - Update user profile
- `DELETE /api/user/account` - Delete user account

### Admin
- `GET /api/admin/users` - List all users
- `GET /api/admin/stats` - Get database statistics
- `DELETE /api/admin/users/:id` - Remove user

### AI Models
- `GET /api/models` - List available Ollama models
- `POST /api/chat/stream` - Stream AI response

---

## 🌐 Supported Languages

- 🇬🇧 English
- 🇩🇪 German (Deutsch)
- 🇮🇹 Italian (Italiano)

---

## ⚡ Performance Configuration

### Ollama Settings
- **OLLAMA_KEEP_ALIVE** - How long to keep model in memory (default: 30m)
- **OLLAMA_STARTUP_PREWARM** - Preload models on startup
- **OLLAMA_PREWARM_TIMEOUT_MS** - Timeout for prewarming (default: 90s)

### Intent NLU Settings
- **INTENT_NLU_ENABLED** - Enable automatic intent detection
- **INTENT_NLU_MODEL** - Model for intent recognition
- **INTENT_NLU_MAX_MEMORY_ITEMS** - Number of memory context items

---

## 🔐 Security Features

- **JWT Authentication** - Secure token-based authentication
- **Bcrypt Password Hashing** - Industry-standard password security
- **CORS Protection** - Cross-origin request validation
- **SQL Injection Prevention** - Using parameterized queries
- **Offline-First Design** - No external API dependencies
- **Input Validation** - Server-side validation of all inputs

---

## 📦 Database Schema

### Users Table
- `id` - Unique user identifier
- `email` - User email (unique)
- `password` - Bcrypt hashed password
- `username` - Display name
- `created_at` - Account creation timestamp
- `updated_at` - Last update timestamp

### Chats Table
- `id` - Chat unique identifier
- `user_id` - Reference to user
- `title` - Chat title
- `created_at` - Chat creation timestamp
- `updated_at` - Last message timestamp

### Messages Table
- `id` - Message unique identifier
- `chat_id` - Reference to chat
- `role` - 'user' or 'assistant'
- `content` - Message content
- `created_at` - Message timestamp

---

## 🐛 Troubleshooting

### Ollama Connection Issues
```bash
# Check if Ollama is running
curl http://localhost:11434/api/tags

# Start Ollama service
ollama serve
```

### Database Errors
```bash
# Reset database (CAUTION: Deletes all data)
rm server/data/wieland.sqlite
```

### Port Already in Use
```bash
# Change port in .env
PORT=3002
```

### Module Not Found Errors
```bash
# Reinstall all dependencies
rm -rf node_modules package-lock.json
npm install
npm run server:install
```

---

## 🤝 Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Code Standards
- Use ESLint for code quality
- Follow React best practices
- Add meaningful commit messages
- Include comments for complex logic

---

## 📝 License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

---

## 👨‍💻 Author

Created by Ryhox

---

## 📞 Support & Contact

For questions or issues:
- 💬 Discussions: GitHub Discussions
- 🐛 Issues: GitHub Issues

---

## 🎉 Acknowledgments

- [Ollama](https://ollama.com) - AI model runtime
- [React](https://react.dev) - UI library
- [Express.js](https://expressjs.com) - Web framework
- [Three.js](https://threejs.org) - 3D graphics
- Community contributors and testers

---

<div align="center">

**[⬆ Back to Top](#wieland-ai)**

Made with ❤️ by Ryhox

</div>
