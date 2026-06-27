const fs = require('fs');
const { parse } = require('csv-parse/sync');

const fileContent = fs.readFileSync('rooms.csv', 'utf-8');
const records = parse(fileContent, {
  skip_empty_lines: true
});

const rooms = [];
let currentBuilding = '';

// The columns for Floor 2 are 2,3,4. Floor 3 are 6,7,8. Floor 4 are 10,11,12.
const floors = [
  { roomCol: 2, bedCol: 3, sizeCol: 4 },
  { roomCol: 6, bedCol: 7, sizeCol: 8 },
  { roomCol: 10, bedCol: 11, sizeCol: 12 }
];

let pendingPairs = { 0: null, 1: null, 2: null }; // Stores the first room of a pair

for (let i = 0; i < records.length; i++) {
  const row = records[i];
  
  if (row[0] && row[0].endsWith('동')) {
    currentBuilding = row[0].replace('동', '');
  }

  if (!currentBuilding) continue;

  for (let fIndex = 0; fIndex < floors.length; fIndex++) {
    const cols = floors[fIndex];
    let roomStr = row[cols.roomCol] ? row[cols.roomCol].trim() : '';
    let bedStr = row[cols.bedCol] ? row[cols.bedCol].trim() : '';
    let sizeStr = row[cols.sizeCol] ? row[cols.sizeCol].trim() : '';

    if (!roomStr) continue;
    
    // Ignore headers
    if (roomStr === '호수') continue;

    let notes = '';
    let isConnecting = true;
    
    if (roomStr.includes('장애인 객실')) {
      roomStr = roomStr.replace('장애인 객실', '').trim();
      notes = '장애인 객실';
      isConnecting = false;
    }

    const roomData = {
      id: `${currentBuilding}-${roomStr}`,
      building: currentBuilding,
      roomNumber: roomStr,
      bedType: bedStr,
      size: sizeStr,
      status: 'available',
      isConnecting,
      adjacent: null,
      notes: notes,
      noiseWarning: ''
    };

    if (isConnecting) {
      if (pendingPairs[fIndex]) {
        // This is the second room of a pair
        const firstRoom = pendingPairs[fIndex];
        firstRoom.adjacent = roomData.roomNumber;
        roomData.adjacent = firstRoom.roomNumber;
        
        rooms.push(firstRoom);
        rooms.push(roomData);
        pendingPairs[fIndex] = null;
      } else {
        // This is the first room of a pair
        pendingPairs[fIndex] = roomData;
      }
    } else {
      // Disabled room
      rooms.push(roomData);
      pendingPairs[fIndex] = null; // Clear pending just in case
    }
  }
}

// Write output
fs.writeFileSync('src/data/roomsData.json', JSON.stringify(rooms, null, 2));
console.log(`Parsed ${rooms.length} rooms perfectly with exact bed sizes!`);
