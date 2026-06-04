import ExcelJS from 'exceljs';

async function run() {
  try {
    const wb = new ExcelJS.Workbook();
    const wsRingkasan = wb.addWorksheet('Ringkasan', { views: [{ showGridLines: false }] });
    
    // add an image to see if extents causes error
    const base64data = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const logoId = wb.addImage({
      base64: base64data,
      extension: 'png',
    });
    
    wsRingkasan.mergeCells('A1:B5');
    wsRingkasan.addImage(logoId, {
      tl: { col: 0.44, row: 0 },
      ext: { width: 110, height: 110 },
      editAs: 'oneCell'
    });

    const cardData = [
      { label: 'Transaksi', val: 5, fmt: null }
    ];

    cardData.forEach((c, idx) => {
      const startLetter = String.fromCharCode(65 + (idx * 2)); // A, C, E, G, I, K, M
      const endLetter = String.fromCharCode(65 + (idx * 2) + 1); // B, D, F, H, J, L, N
      
      // Row 7 (Label)
      wsRingkasan.mergeCells(`${startLetter}7:${endLetter}7`);
      const labelCell = wsRingkasan.getCell(`${startLetter}7`);
      labelCell.value = c.label;
      labelCell.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
      labelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB42829' } };
      labelCell.alignment = { horizontal: 'center', vertical: 'middle' };
      
      // Row 8-11 (Value)
      wsRingkasan.mergeCells(`${startLetter}8:${endLetter}11`);
      const valCell = wsRingkasan.getCell(`${startLetter}8`);
      valCell.value = c.val;
      valCell.font = { bold: true, size: 18, color: { argb: 'FFB42829' } };
      valCell.alignment = { horizontal: 'center', vertical: 'middle' };

      for (let r = 7; r <= 11; r++) {
        wsRingkasan.getCell(`${startLetter}${r}`).border = { top: { style: 'thin' } };
      }
    });

    await wb.xlsx.writeBuffer();
    console.log("SUCCESS");
  } catch(e) {
    console.error("ERROR:", e);
  }
}
run();
