const fs = require('fs');

const disabledRooms = {
  '101': '305',
  '102': '305',
  '103': '405',
  '104': '205',
  '105': '305'
};

const rooms = [];

for (let b = 1; b <= 5; b++) {
  const building = `10${b}`;
  const dRoom = disabledRooms[building];

  for (let f = 2; f <= 4; f++) {
    const floor = `${f}`;
    const disabledOnThisFloor = dRoom && dRoom.startsWith(floor) ? dRoom : null;
    
    // Total rooms on this floor is 11 if there's a disabled room, else 12
    const totalRooms = disabledOnThisFloor ? 11 : 12;

    for (let i = 1; i <= totalRooms; i++) {
      const numStr = i < 10 ? `0${i}` : `${i}`;
      const roomNumber = `${floor}${numStr}`;
      
      const isDisabled = roomNumber === disabledOnThisFloor;
      
      let adjacent = null;
      let isConnecting = false;
      let size = '16P'; // Default, we will alternate
      
      if (isDisabled) {
        size = '51P';
        isConnecting = false;
      } else {
        isConnecting = true;
        // Determine pair. 
        // Before the disabled room, pairs are (1,2), (3,4).
        // After the disabled room, pairs are (6,7), (8,9), (10,11)
        // Note: The disabled room is always 'x05'. So room numbers 06-11 are paired.
        
        const num = parseInt(numStr);
        let pairNum;
        if (num % 2 === 1) { // 1, 3, 7, 9, 11
          pairNum = num + 1;
        } else { // 2, 4, 6, 8, 10
          pairNum = num - 1;
        }
        
        adjacent = `${floor}${pairNum < 10 ? '0' + pairNum : pairNum}`;
      }

      rooms.push({
        id: `${building}-${roomNumber}`,
        building,
        roomNumber,
        bedType: 'Q+S', // Simplified, UI can edit later if needed
        size,
        status: 'available',
        isConnecting,
        adjacent,
        notes: isDisabled ? '장애인객실' : '',
        noiseWarning: ''
      });
    }
  }
}

fs.writeFileSync('src/data/roomsData.json', JSON.stringify(rooms, null, 2));
console.log(`Generated ${rooms.length} rooms correctly!`);
