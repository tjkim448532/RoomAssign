const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");
const { parse } = require("csv-parse");

// Initialize Firebase Admin
const serviceAccount = require("E:\\앱\\roomassign-f04a6-firebase-adminsdk-fbsvc-16d6373b8a.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function uploadRooms() {
  const rooms = [];
  const parser = fs.createReadStream(path.join(__dirname, 'rooms.csv'))
    .pipe(parse({ columns: true, skip_empty_lines: true }));

  for await (const row of parser) {
    if (!row['동'] || !row['호수']) continue;
    
    // Example: 101동, 201호
    const building = row['동'].replace('동', '');
    const roomNumber = row['호수'];
    const id = `${building}-${roomNumber}`;
    const bedType = row['침대타입(코드)'];
    const adjacent = row['인접호수'] || null;
    const combined = row['결합시평형'] === '51평';
    
    rooms.push({
      id,
      building,
      roomNumber,
      bedType,
      adjacent,
      isConnecting: combined,
      status: 'available', // available, assigned, blocked
      notes: row['특이사항'] || '',
      noiseWarning: row['소음주의여부'] || ''
    });
  }

  console.log(`Parsed ${rooms.length} rooms. Uploading to Firestore...`);

  // Batch upload
  const chunks = [];
  for (let i = 0; i < rooms.length; i += 500) {
    chunks.push(rooms.slice(i, i + 500));
  }

  let totalUploaded = 0;
  for (const chunk of chunks) {
    const batch = db.batch();
    chunk.forEach(room => {
      const roomRef = db.collection('rooms').doc(room.id);
      batch.set(roomRef, room);
    });
    await batch.commit();
    totalUploaded += chunk.length;
    console.log(`Uploaded ${totalUploaded} / ${rooms.length}`);
  }

  console.log("Upload complete!");
  process.exit(0);
}

uploadRooms().catch(console.error);
