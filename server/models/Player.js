const mongoose = require('mongoose');

const playerSchema = new mongoose.Schema({
  socketId: { type: String, required: true, unique: true },
  username: { type: String,default: 'Anonymous' },
  avatar: { type: String }, // New: Store avatar emoji
  wins: { type: Number, default: 0 },
});

module.exports = mongoose.model('Player', playerSchema);