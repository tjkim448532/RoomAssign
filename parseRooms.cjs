const fs = require('fs');

const raw = fs.readFileSync('rooms.csv', 'utf-8');
const lines = raw.split('\n');

const rooms = [];
let currentBuilding = '';

for (const line of lines) {
  const parts = line.split(',');
  if (parts.length < 10) continue; // Skip empty or malformed lines

  // If column 0 has a building name like "101동", update currentBuilding
  if (parts[0] && parts[0].includes('동')) {
    currentBuilding = parts[0].replace(/"/g, '').trim().replace('동', '');
  }

  if (!currentBuilding) continue;

  // Floor 2 block: parts[1] (type), parts[2] (room), parts[3] (bed), parts[4] (size)
  // Floor 3 block: parts[5] (type), parts[6] (room), parts[7] (bed), parts[8] (size)
  // Floor 4 block: parts[9] (type), parts[10] (room), parts[11] (bed), parts[12] (size)

  const parseBlock = (roomCol, bedCol, sizeCol) => {
    let roomStr = parts[roomCol] ? parts[roomCol].replace(/"/g, '').replace(/\r/g, '').trim() : '';
    let bedStr = parts[bedCol] ? parts[bedCol].replace(/"/g, '').replace(/\r/g, '').trim() : '';
    let sizeStr = parts[sizeCol] ? parts[sizeCol].replace(/"/g, '').replace(/\r/g, '').trim() : '';

    // Handle the special "장애인 객실" which might be split across lines or concatenated with \n in CSV
    if (roomStr.includes('장애인')) {
      roomStr = roomStr.replace(/[^0-9]/g, '');
      sizeStr = '51P'; // Explicitly set
    }
    
    // Sometimes room is empty but bed is there (due to merged cells for disabled rooms)
    if (!roomStr && !bedStr) return;
    
    // If room is empty but bed/size exists, it might be the second line of a merged 51P cell.
    // In the CSV: "305\n장애인객실", "Q+S", "51P"
    // Next line: "", "S+S", ""
    // We can just ignore the second bed type for the same room or append it, but since it's 1 disabled room, let's just register it once when we see the room number.

    if (roomStr.match(/^\d+$/)) {
      rooms.push({
        id: `${currentBuilding}-${roomStr}`,
        building: currentBuilding,
        roomNumber: roomStr,
        bedType: bedStr,
        size: sizeStr,
        status: 'available',
        isConnecting: sizeStr === '16P' || sizeStr === '35P',
      });
    }
  };

  parseBlock(2, 3, 4);
  parseBlock(6, 7, 8);
  parseBlock(10, 11, 12);
}

// Post-process to link connecting rooms
const processedRooms = rooms.map(room => {
  let adjacent = null;
  if (room.isConnecting) {
    const num = parseInt(room.roomNumber);
    // Usually 201-202, 203-204 are pairs. If num is odd, adjacent is num+1. If even, num-1.
    // Let's verify by finding the partner in the same building.
    const partnerNum = num % 2 === 1 ? num + 1 : num - 1;
    const partner = rooms.find(r => r.building === room.building && r.roomNumber === partnerNum.toString());
    if (partner && partner.isConnecting) {
      adjacent = partner.roomNumber;
    } else {
      room.isConnecting = false; // Orphaned connecting room (shouldn't happen, but just in case)
    }
  }
  return { ...room, adjacent };
});

fs.writeFileSync('src/data/roomsData.json', JSON.stringify(processedRooms, null, 2));
console.log(`Parsed ${processedRooms.length} rooms.`);
