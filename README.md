 # Level Devil 🎮

A multiplayer game server with real-time communication, user authentication, and Level-based gameplay.

## 📋 Table of Contents
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Running the App](#running-the-app)
- [Project Structure](#project-structure)
- [Contributing](#contributing)
- [Scripts](#scripts)

## Prerequisites

Before you start, make sure you have the following installed:

- **Node.js** (v18.0.0 or higher) - [Download here](https://nodejs.org/)
- **npm** (comes with Node.js)
- **MongoDB** - [Install locally](https://docs.mongodb.com/manual/installation/) or use [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) for cloud database

You can verify installations by running:
```bash
node --version
npm --version
```

## Installation

1. **Clone the repository**
```bash
git clone https://github.com/yourusername/leveldevil.git
cd leveldevil
```

2. **Install dependencies**
```bash
npm install
```

This will install all required packages:
- `express` - Web framework
- `socket.io` - Real-time communication
- `mongoose` - MongoDB object modeling
- `jsonwebtoken` - Authentication
- `bcryptjs` - Password hashing
- `cors` - Cross-origin requests
- `dotenv` - Environment variable management

## Configuration

1. **Create a `.env` file** in the root directory:
```bash
cp .env.example .env   # If an example exists, or create manually
```

2. **Add your environment variables** to `.env`:
```

# Database
MONGODB_URI=mongodb://localhost:27017/leveldevil
# Or use MongoDB Atlas:
# MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/leveldevil

# JWT Secret (generate a random string)
JWT_SECRET=your_super_secret_jwt_key_here_change_in_production

# Render Server Running 
RENDER_EXTERNAL_URL=https://level-devil-b7rf.onrender.com/
```

⚠️ **Important**: Add `.env` to `.gitignore` to keep secrets safe:
```
.env
*.env
```

## Running the App

### Development Mode (with auto-reload)
```bash
node server/server.js
```
The server will start on `http://localhost:3000` and automatically reload when you make changes.

### Production Mode
```bash
node server/server.js
```
The server will start on `http://localhost:3000`

## Project Structure

```
leveldevil/
├── src/                          # Main source code
│   ├── audio.js                 # Audio handling
│   ├── auth-and-ui.js          # Authentication & UI
│   ├── game-systems.js         # Game mechanics
│   ├── gameplay-update.js      # Game state updates
│   ├── input-and-boot.js       # Input handling
│   ├── multiplayer-core.js     # Multiplayer logic
│   ├── render.js               # Rendering engine
│   ├── ui-tools.js             # UI utilities
│   ├── voice.js                # Voice chat
│   ├── gameplay/               # Gameplay modules
│   ├── render/                 # Rendering modules
│   └── traps/                  # Trap mechanics
├── server/
│   └── server.js               # Express server and Socket.io setup
├── levels/                      # Level data files (JSON)
│   ├── level1.json
│   ├── level2.json
│   └── ... (level25.json)
├── assets/
│   ├── images/                 # Game images
│   └── music/                  # Game audio
├── scripts/
│   └── build-client-bundle.js # Build script for client
├── index.html                  # Main HTML file
├── package.json               # Project dependencies
├── .env                       # Environment variables (DO NOT COMMIT)
├── .gitignore                # Git ignore rules
└── README.md                 # This file
```

## Features

- 🎮 **Real-time Multiplayer** - WebSocket communication via Socket.io
- 👤 **User Authentication** - JWT-based auth with bcrypt password hashing
- 📊 **Level System** - Load levels from JSON files
- 🎨 **Dynamic Rendering** - Custom render engine
- 🎙️ **Voice Communication** - Built-in voice support
- 🪤 **Trap Mechanics** - Advanced trap system
- 🏎️ **Fast Server** - Express-based high-performance server

## Contributing

We welcome contributions! Please follow these steps:

### 1. Fork and Clone
```bash
git clone https://github.com/yourusername/leveldevil.git
cd leveldevil
```

### 2. Create a Feature Branch
```bash
git checkout -b feature/your-feature-name
```

### 3. Make Your Changes
- Write clean, readable code
- Follow the existing code style
- Add comments for complex logic
- Test your changes locally

### 4. Commit Your Changes
```bash
git add .
git commit -m "Add: Brief description of your changes"
```

Use conventional commit messages:
- `Add:` for new features
- `Fix:` for bug fixes
- `Update:` for improvements
- `Refactor:` for code restructuring
- `Docs:` for documentation

### 5. Push to Your Fork
```bash
git push origin feature/your-feature-name
```

### 6. Create a Pull Request
- Go to GitHub and create a Pull Request
- Describe your changes clearly
- Reference any related issues

### Guidelines
- Keep PRs focused on a single feature/fix
- Update documentation if needed
- Test thoroughly before submitting
- Follow the existing code structure
- Ensure `.env` is never committed

## Troubleshooting

### Port Already in Use
If port 3000 is already in use, change it in your `server.js`:


### MongoDB Connection Error
- Ensure MongoDB is running locally: `mongod`
- Or check your MongoDB Atlas connection string
- Verify `MONGODB_URI` in `.env` is correct

### Module Not Found
```bash
rm -rf node_modules package-lock.json
npm install
```

## Support

For issues, questions, or suggestions:
1. Check existing GitHub issues
2. Create a new issue with detailed description


---

Happy coding! 🚀
