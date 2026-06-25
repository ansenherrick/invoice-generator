export const exportElementToPdf = async (element: HTMLElement, fileName: string) => {
  const html2pdf = (await import("html2pdf.js")).default;

  await html2pdf()
    .set({
      margin: 0.2,
      filename: fileName,
      image: { type: "jpeg", quality: 0.98 },
      html2canvas: {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
      },
      pagebreak: {
        mode: ["css", "legacy"],
        avoid: [".invoice-sheet__hero", ".invoice-sheet__title-group", ".invoice-sheet__signature", "tr"],
      },
      jsPDF: {
        unit: "in",
        format: "letter",
        orientation: "portrait",
      },
    })
    .from(element)
    .save();
};
