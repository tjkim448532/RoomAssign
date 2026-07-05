import { runAutoAssignment } from './src/utils/autoAssigner.js';

const reservations = [
  {
    reservationId: "R1",
    customerName: "홍길동",
    roomType: "51P",
    stayLength: 2,
    checkInDate: "2026-07-05T00:00:00Z"
  }
];

const currentRooms = [
  { id: "room1", roomNumber: "101", building: "1", size: "51P", status: "available", isConnecting: true, adjacent: "102" },
  { id: "room2", roomNumber: "102", building: "1", size: "16P", status: "available" }
];

async function test() {
  console.log("Starting test...");
  try {
    const result = await runAutoAssignment(reservations, currentRooms);
    console.log("Result:", JSON.stringify(result, null, 2));
  } catch(e) {
    console.error("Error:", e);
  }
}

test();
