async function test() {
  console.log("Fetching Vercel API...");
  try {
    const res = await fetch("https://belleforet-data.vercel.app/api/v3/roomassign/reservations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reservations: [], rules: [] })
    });
    console.log("Status:", res.status);
    const text = await res.text();
    console.log("Response:", text);
  } catch (err) {
    console.error("Error:", err);
  }
}

test();
