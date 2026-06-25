export const exportElementToPdf = async (element: HTMLElement, fileName: string) => {
  const html2pdf = (await import("html2pdf.js")).default;

  await html2pdf()
    .set({
      margin: 0.3,
      filename: fileName,
      image: { type: "jpeg", quality: 0.98 },
      html2canvas: {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
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
