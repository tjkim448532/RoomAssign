import mysql from 'mysql2/promise';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, DB_PORT } = process.env;

  if (!DB_HOST || !DB_USER || !DB_PASSWORD || !DB_NAME) {
    return res.status(500).json({ 
      error: 'Database configuration missing', 
      message: '환경 변수에 MariaDB 접속 정보(DB_HOST, DB_USER, DB_PASSWORD, DB_NAME)가 설정되지 않았습니다.' 
    });
  }

  let connection;

  try {
    // Create a connection
    connection = await mysql.createConnection({
      host: DB_HOST,
      user: DB_USER,
      password: DB_PASSWORD,
      database: DB_NAME,
      port: DB_PORT || 3306,
      connectTimeout: 5000 // 5 seconds timeout
    });

    // 1. Fetch Reservations
    const [reservationsRows] = await connection.execute(
      `SELECT reservation_id as reservationId,
              customer_name as customerName,
              room_type as roomType,
              check_in_date as checkInDate,
              check_out_date as checkOutDate,
              stay_length as stayLength,
              adults,
              children,
              notes,
              status,
              assigned_room_id as assignedRoom
       FROM ai_reservation_summary`
    );

    // 2. Fetch Rooms Inventory
    const [roomsRows] = await connection.execute(
      `SELECT room_id as id,
              building,
              room_number as roomNumber,
              size,
              bed_type as bedType,
              status,
              is_connecting as isConnecting,
              adjacent_room as adjacent,
              housekeeping_notes as notes
       FROM ai_room_inventory_summary`
    );

    // Boolean mapping for tinyint in mysql
    const formattedRooms = roomsRows.map(room => ({
      ...room,
      isConnecting: Boolean(room.isConnecting)
    }));

    res.status(200).json({
      success: true,
      data: {
        reservations: reservationsRows,
        rooms: formattedRooms
      }
    });

  } catch (error) {
    console.error('MariaDB Connection Error:', error);
    res.status(500).json({ 
      error: 'Database Query Failed', 
      message: error.message 
    });
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}
