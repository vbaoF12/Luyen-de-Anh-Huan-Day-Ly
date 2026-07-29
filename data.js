const EXAM_DATA = {
  title: "Đề luyện tổng hợp Vật lí THPT số 01",
  durationMinutes: 50,
  mcq: [
    {
      id: 1,
      topic: "Cơ học",
      stem: "Một vật chuyển động thẳng có phương trình tọa độ x = 2 + 3t (x tính bằng mét, t tính bằng giây). Vận tốc của vật bằng",
      options: ["2 m/s", "3 m/s", "5 m/s", "6 m/s"],
      answer: 1,
      explanation: "Trong chuyển động thẳng đều, hệ số của t trong phương trình x = x₀ + vt chính là vận tốc. Do đó v = 3 m/s."
    },
    {
      id: 2,
      topic: "Động lực học",
      stem: "Một vật khối lượng 2 kg chịu lực kéo 10 N theo phương ngang và lực ma sát 2 N ngược chiều chuyển động. Gia tốc của vật là",
      options: ["2 m/s²", "4 m/s²", "5 m/s²", "6 m/s²"],
      answer: 1,
      explanation: "Hợp lực F = 10 − 2 = 8 N. Theo định luật II Newton: a = F/m = 8/2 = 4 m/s²."
    },
    {
      id: 3,
      topic: "Năng lượng",
      stem: "Một vật khối lượng 0,5 kg chuyển động với tốc độ 4 m/s. Động năng của vật bằng",
      options: ["2 J", "4 J", "8 J", "16 J"],
      answer: 1,
      explanation: "Wđ = 1/2·mv² = 1/2·0,5·4² = 4 J."
    },
    {
      id: 4,
      topic: "Khí lí tưởng",
      stem: "Một lượng khí có thể tích 2 lít ở 300 K. Khi tăng nhiệt độ lên 450 K và giữ áp suất không đổi, thể tích của khí là",
      options: ["1,33 lít", "2,50 lít", "3,00 lít", "4,50 lít"],
      answer: 2,
      explanation: "Quá trình đẳng áp có V/T không đổi. V₂ = V₁T₂/T₁ = 2·450/300 = 3 lít."
    },
    {
      id: 5,
      topic: "Vật lí nhiệt",
      stem: "Động năng tịnh tiến trung bình của các phân tử khí lí tưởng phụ thuộc trực tiếp vào",
      options: ["áp suất của khí", "thể tích của khí", "nhiệt độ tuyệt đối", "khối lượng của bình"],
      answer: 2,
      explanation: "Động năng tịnh tiến trung bình của phân tử khí lí tưởng tỉ lệ thuận với nhiệt độ tuyệt đối T."
    },
    {
      id: 6,
      topic: "Dao động",
      stem: "Một vật dao động điều hòa theo phương trình x = 5cos(4πt) cm. Chu kì dao động là",
      options: ["0,25 s", "0,50 s", "1,00 s", "2,00 s"],
      answer: 1,
      explanation: "ω = 4π rad/s, nên T = 2π/ω = 0,5 s."
    },
    {
      id: 7,
      topic: "Sóng cơ",
      stem: "Một sóng cơ có tần số 20 Hz và bước sóng 0,5 m. Tốc độ truyền sóng bằng",
      options: ["5 m/s", "10 m/s", "20 m/s", "40 m/s"],
      answer: 1,
      explanation: "v = fλ = 20·0,5 = 10 m/s."
    },
    {
      id: 8,
      topic: "Âm học",
      stem: "Mức cường độ âm tăng thêm 20 dB thì cường độ âm tăng lên bao nhiêu lần?",
      options: ["2 lần", "10 lần", "20 lần", "100 lần"],
      answer: 3,
      explanation: "ΔL = 10log(I₂/I₁) = 20 dB nên I₂/I₁ = 10² = 100."
    },
    {
      id: 9,
      topic: "Điện trường",
      stem: "Điện tích điểm Q = 2 μC đặt trong chân không. Cường độ điện trường tại điểm cách Q một khoảng 0,30 m gần bằng",
      options: ["2,0×10⁴ N/C", "6,0×10⁴ N/C", "2,0×10⁵ N/C", "6,0×10⁵ N/C"],
      answer: 2,
      explanation: "E = k|Q|/r² = 9×10⁹·2×10⁻⁶/0,3² = 2×10⁵ N/C."
    },
    {
      id: 10,
      topic: "Dòng điện",
      stem: "Đặt hiệu điện thế 12 V vào hai đầu điện trở 6 Ω. Cường độ dòng điện qua điện trở là",
      options: ["0,5 A", "2 A", "6 A", "72 A"],
      answer: 1,
      explanation: "Theo định luật Ohm: I = U/R = 12/6 = 2 A."
    },
    {
      id: 11,
      topic: "Mạch điện",
      stem: "Hai điện trở 2 Ω và 4 Ω mắc nối tiếp. Điện trở tương đương của đoạn mạch là",
      options: ["1,33 Ω", "2 Ω", "4 Ω", "6 Ω"],
      answer: 3,
      explanation: "Mắc nối tiếp: Rtđ = R₁ + R₂ = 2 + 4 = 6 Ω."
    },
    {
      id: 12,
      topic: "Điện năng",
      stem: "Một ấm điện ghi 220 V – 1100 W hoạt động đúng định mức. Cường độ dòng điện qua ấm gần bằng",
      options: ["0,2 A", "2 A", "5 A", "242 A"],
      answer: 2,
      explanation: "P = UI nên I = P/U = 1100/220 = 5 A."
    },
    {
      id: 13,
      topic: "Từ trường",
      stem: "Đoạn dây dài 0,40 m mang dòng điện 5 A đặt vuông góc với từ trường đều B = 0,20 T. Lực từ tác dụng lên dây bằng",
      options: ["0,04 N", "0,20 N", "0,40 N", "4,00 N"],
      answer: 2,
      explanation: "F = BIl sin90° = 0,2·5·0,4 = 0,4 N."
    },
    {
      id: 14,
      topic: "Cảm ứng điện từ",
      stem: "Cuộn dây 100 vòng có từ thông qua mỗi vòng giảm đều 0,002 Wb trong 0,10 s. Độ lớn suất điện động cảm ứng là",
      options: ["0,2 V", "1 V", "2 V", "20 V"],
      answer: 2,
      explanation: "|e| = N|ΔΦ|/Δt = 100·0,002/0,1 = 2 V."
    },
    {
      id: 15,
      topic: "Lượng tử ánh sáng",
      stem: "Năng lượng của photon ánh sáng có bước sóng 600 nm gần bằng (h = 6,625×10⁻³⁴ J·s; c = 3×10⁸ m/s)",
      options: ["1,10×10⁻¹⁹ J", "2,21×10⁻¹⁹ J", "3,31×10⁻¹⁹ J", "6,63×10⁻¹⁹ J"],
      answer: 2,
      explanation: "ε = hc/λ = 6,625×10⁻³⁴·3×10⁸/(600×10⁻⁹) ≈ 3,31×10⁻¹⁹ J."
    },
    {
      id: 16,
      topic: "Quang điện",
      stem: "Kim loại có công thoát 3 eV được chiếu bởi photon năng lượng 5 eV. Động năng ban đầu cực đại của electron quang điện là",
      options: ["1 eV", "2 eV", "3 eV", "8 eV"],
      answer: 1,
      explanation: "Theo phương trình Einstein: Kmax = ε − A = 5 − 3 = 2 eV."
    },
    {
      id: 17,
      topic: "Phóng xạ",
      stem: "Một chất phóng xạ có chu kì bán rã 8 ngày. Sau 24 ngày, số hạt nhân chưa phân rã còn lại bằng bao nhiêu phần số ban đầu?",
      options: ["1/2", "1/4", "1/8", "1/16"],
      answer: 2,
      explanation: "24 ngày tương ứng 3 chu kì bán rã, nên N/N₀ = (1/2)³ = 1/8."
    },
    {
      id: 18,
      topic: "Vật lí hạt nhân",
      stem: "Đại lượng đặc trưng trực tiếp cho mức độ bền vững của hạt nhân là",
      options: ["số proton", "số neutron", "năng lượng liên kết riêng", "độ hụt khối"],
      answer: 2,
      explanation: "Hạt nhân có năng lượng liên kết riêng càng lớn thì càng bền vững."
    }
  ],
  trueFalse: [
    {
      id: 19,
      topic: "Khí lí tưởng",
      context: "Một lượng khí lí tưởng xác định được nung nóng trong một bình kín, cứng. Bỏ qua sự nở vì nhiệt của bình.",
      statements: [
        { text: "Thể tích của lượng khí không đổi.", answer: true, explanation: "Bình kín và cứng nên thể tích khí được giữ không đổi." },
        { text: "Áp suất của khí tỉ lệ thuận với nhiệt độ Celsius.", answer: false, explanation: "Áp suất tỉ lệ thuận với nhiệt độ tuyệt đối Kelvin, không phải trực tiếp với nhiệt độ Celsius." },
        { text: "Nếu nhiệt độ tuyệt đối tăng gấp đôi thì áp suất tăng gấp đôi.", answer: true, explanation: "Ở quá trình đẳng tích, p/T là hằng số." },
        { text: "Khối lượng riêng của khí giảm khi nhiệt độ tăng.", answer: false, explanation: "Khối lượng và thể tích đều không đổi nên khối lượng riêng không đổi." }
      ]
    },
    {
      id: 20,
      topic: "Dao động điều hòa",
      context: "Một vật gắn với lò xo dao động điều hòa trên mặt phẳng ngang, bỏ qua ma sát.",
      statements: [
        { text: "Tại vị trí cân bằng, tốc độ của vật đạt cực đại.", answer: true, explanation: "Ở vị trí cân bằng, thế năng nhỏ nhất và động năng lớn nhất." },
        { text: "Tại biên, gia tốc của vật bằng không.", answer: false, explanation: "Tại biên, độ lớn gia tốc đạt cực đại: |a| = ω²A." },
        { text: "Cơ năng của hệ được bảo toàn.", answer: true, explanation: "Không có ma sát nên cơ năng không đổi." },
        { text: "Tăng biên độ làm chu kì dao động tăng.", answer: false, explanation: "Với con lắc lò xo lí tưởng, T = 2π√(m/k), không phụ thuộc biên độ." }
      ]
    },
    {
      id: 21,
      topic: "Điện học",
      context: "Một gia đình sử dụng mạng điện xoay chiều 220 V và các thiết bị được mắc song song vào mạng điện.",
      statements: [
        { text: "Mỗi thiết bị nhận cùng hiệu điện thế 220 V khi hoạt động bình thường.", answer: true, explanation: "Các thiết bị mắc song song nên có cùng hiệu điện thế nguồn." },
        { text: "Tắt một thiết bị thì các thiết bị còn lại bắt buộc cũng ngừng hoạt động.", answer: false, explanation: "Các nhánh song song hoạt động độc lập." },
        { text: "Cầu chì hoặc aptomat giúp bảo vệ mạch khi dòng điện quá lớn.", answer: true, explanation: "Thiết bị bảo vệ sẽ ngắt mạch khi quá tải hoặc xảy ra sự cố." },
        { text: "Dây nối đất làm tăng công suất tiêu thụ của thiết bị.", answer: false, explanation: "Dây nối đất có vai trò an toàn điện, không nhằm tăng công suất tiêu thụ." }
      ]
    },
    {
      id: 22,
      topic: "Phóng xạ",
      context: "Xét một mẫu chất phóng xạ tự nhiên được bảo quản trong điều kiện thông thường.",
      statements: [
        { text: "Phóng xạ là quá trình biến đổi tự phát của hạt nhân không bền.", answer: true, explanation: "Phóng xạ xảy ra tự phát ở các hạt nhân không bền." },
        { text: "Chu kì bán rã phụ thuộc mạnh vào nhiệt độ của mẫu.", answer: false, explanation: "Chu kì bán rã hầu như không phụ thuộc các điều kiện vật lí, hóa học thông thường." },
        { text: "Sau một chu kì bán rã, số hạt nhân mẹ chưa phân rã còn một nửa.", answer: true, explanation: "Đây là định nghĩa của chu kì bán rã." },
        { text: "Độ phóng xạ của mẫu tăng dần theo thời gian.", answer: false, explanation: "Độ phóng xạ H = λN giảm theo thời gian do N giảm." }
      ]
    }
  ],
  shortAnswer: [
    {
      id: 23,
      topic: "Chuyển động ném",
      stem: "Một vật được ném xiên từ mặt đất với tốc độ ban đầu 20 m/s, góc ném 30° so với phương ngang. Lấy g = 10 m/s². Tầm xa của vật bằng bao nhiêu mét? Làm tròn đến một chữ số thập phân.",
      answer: 34.6,
      tolerance: 0.06,
      unit: "m",
      explanation: "L = v₀²sin(2α)/g = 20²·sin60°/10 ≈ 34,6 m."
    },
    {
      id: 24,
      topic: "Khí lí tưởng",
      stem: "Một lượng khí có thể tích 2,4 lít ở 300 K. Giữ áp suất không đổi và tăng nhiệt độ lên 375 K. Thể tích mới của khí bằng bao nhiêu lít?",
      answer: 3,
      tolerance: 0.01,
      unit: "lít",
      explanation: "V₂ = V₁T₂/T₁ = 2,4·375/300 = 3,0 lít."
    },
    {
      id: 25,
      topic: "Dao động",
      stem: "Con lắc lò xo gồm vật 0,25 kg và lò xo có độ cứng 100 N/m. Chu kì dao động bằng bao nhiêu giây? Lấy π = 3,14 và làm tròn đến ba chữ số thập phân.",
      answer: 0.314,
      tolerance: 0.002,
      unit: "s",
      explanation: "T = 2π√(m/k) = 2·3,14·√(0,25/100) = 0,314 s."
    },
    {
      id: 26,
      topic: "Điện năng",
      stem: "Điện trở 12 Ω được mắc vào nguồn 24 V trong 5 phút. Điện năng tiêu thụ bằng bao nhiêu kJ?",
      answer: 14.4,
      tolerance: 0.02,
      unit: "kJ",
      explanation: "P = U²/R = 48 W; A = Pt = 48·300 = 14400 J = 14,4 kJ."
    },
    {
      id: 27,
      topic: "Máy biến áp",
      stem: "Máy biến áp lí tưởng có N₁ = 1000 vòng, N₂ = 100 vòng. Đặt điện áp 220 V vào cuộn sơ cấp. Điện áp hiệu dụng ở cuộn thứ cấp bằng bao nhiêu vôn?",
      answer: 22,
      tolerance: 0.01,
      unit: "V",
      explanation: "U₂/U₁ = N₂/N₁ nên U₂ = 220·100/1000 = 22 V."
    },
    {
      id: 28,
      topic: "Phóng xạ",
      stem: "Mẫu chất phóng xạ có khối lượng ban đầu 160 mg và chu kì bán rã 6 giờ. Sau 18 giờ, khối lượng chất chưa phân rã còn bao nhiêu mg?",
      answer: 20,
      tolerance: 0.01,
      unit: "mg",
      explanation: "18 giờ bằng 3 chu kì bán rã, nên m = 160·(1/2)³ = 20 mg."
    }
  ]
};
