/**
 * AI 고객 선호도 분석 모듈
 * 실제 구현 시 Google Gemini API 또는 OpenAI API 연동 코드로 교체합니다.
 */

export async function analyzeCustomerPreferences(notes) {
  if (!notes || notes.trim() === "") {
    return {
      wantsHighFloor: false,
      wantsLowFloor: false,
      needsAccessible: false,
      isConnectingRequired: false,
      otherKeywords: []
    };
  }

  console.log(`AI가 고객의 메모를 분석 중입니다: "${notes}"`);
  
  // TODO: 실제 AI API 연동
  /*
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a hotel room assignment assistant. Extract preferences from notes as JSON: {wantsHighFloor, wantsLowFloor, needsAccessible, isConnectingRequired, otherKeywords}" },
        { role: "user", content: notes }
      ]
    })
  });
  const data = await response.json();
  return JSON.parse(data.choices[0].message.content);
  */

  // 개발용 Mock AI 판단 로직 (단순 규칙 및 키워드 기반 시뮬레이션)
  return new Promise((resolve) => {
    setTimeout(() => {
      const preferences = {
        wantsHighFloor: notes.includes("고층") || notes.includes("높은"),
        wantsLowFloor: notes.includes("저층") || notes.includes("1층") || notes.includes("낮은"),
        needsAccessible: notes.includes("휠체어") || notes.includes("장애인") || notes.includes("노약자"),
        isConnectingRequired: notes.includes("붙어있는") || notes.includes("커넥팅") || notes.includes("대가족"),
        otherKeywords: []
      };
      
      if (notes.includes("조용한")) preferences.otherKeywords.push("quiet");
      if (notes.includes("뷰")) preferences.otherKeywords.push("good_view");
      
      resolve(preferences);
    }, 1500); // AI 추론 시간 1.5초 시뮬레이션
  });
}
