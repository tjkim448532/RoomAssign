const today = new Date().toISOString().slice(0,10);
const res = await fetch(`https://belleforet-data.vercel.app/api/v3/roomassign/mariadb-summary?targetDate=${today}`);
const json = await res.json();
if (json.data && json.data.reservations && json.data.reservations.length > 0) {
  console.log(JSON.stringify(json.data.reservations[0], null, 2));
} else {
  console.log('No reservations for today:', today);
}
