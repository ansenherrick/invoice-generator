import { calculateInvoiceSummary, type InvoiceDraft, type ProfileData } from "@invoice/shared";

type InvoicePreviewProps = {
  draft: InvoiceDraft;
  profile: ProfileData | null;
};

const currencyFormatter = (currency: string) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  });

export const InvoicePreview = ({ draft, profile }: InvoicePreviewProps) => {
  const summary = calculateInvoiceSummary(draft);
  const formatter = currencyFormatter(draft.currency);

  return (
    <section className="invoice-sheet" id="invoice-sheet">
      <div className="invoice-sheet__hero">
        <div className="invoice-sheet__line" />
        <div className="invoice-sheet__title-group">
          {profile?.logoUrl ? <img className="invoice-sheet__logo" src={profile.logoUrl} alt="Business logo" /> : null}
          <h2>INVOICE</h2>
        </div>
      </div>

      <div className="invoice-sheet__meta">
        <div>
          <span className="section-kicker">Issued To:</span>
          <p>{draft.client.name || "Client name"}</p>
          {draft.client.businessName ? <p>{draft.client.businessName}</p> : null}
          {draft.client.addressLines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
        <div className="invoice-sheet__numbers">
          <div>
            <strong>Invoice No:</strong>
            <span>{draft.invoiceNumber || "Pending"}</span>
          </div>
          <div>
            <strong>Date:</strong>
            <span>{draft.issueDate}</span>
          </div>
          <div>
            <strong>Due Date:</strong>
            <span>{draft.dueDate}</span>
          </div>
        </div>
      </div>

      <div className="invoice-sheet__payments">
        <div>
          <span className="section-kicker">{profile?.paymentPrimary.label || "Preferred Payment"}:</span>
          {profile?.paymentPrimary.details.length ? (
            profile.paymentPrimary.details.map((line) => <p key={line}>{line}</p>)
          ) : (
            <p>Add your bank or payment details in profile settings.</p>
          )}
        </div>
        <div>
          <span className="section-kicker">{profile?.paymentSecondary.label || "Secondary Payment"}:</span>
          {profile?.paymentSecondary.details.length ? (
            profile.paymentSecondary.details.map((line) => <p key={line}>{line}</p>)
          ) : (
            <p>Add backup payment details in profile settings.</p>
          )}
        </div>
      </div>

      <table className="invoice-sheet__table">
        <thead>
          <tr>
            <th>Description</th>
            <th>Unit Price</th>
            <th>Qty</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {draft.items.map((item) => (
            <tr key={item.id}>
              <td>
                <strong>{item.task}</strong>
                {item.description ? <div>{item.description}</div> : null}
                {item.date ? <div>{item.date}</div> : null}
              </td>
              <td>{formatter.format(item.unitPrice)}</td>
              <td>
                {item.quantity}
                {item.unitLabel ? ` ${item.unitLabel}` : ""}
              </td>
              <td>{formatter.format(item.quantity * item.unitPrice)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="invoice-sheet__totals">
        <div>
          {draft.notes ? (
            <>
              <span className="section-kicker">Notes:</span>
              <p>{draft.notes}</p>
            </>
          ) : null}
        </div>
        <div className="invoice-sheet__summary">
          <div>
            <strong>Subtotal</strong>
            <span>{formatter.format(summary.subtotal)}</span>
          </div>
          <div>
            <strong>Tax</strong>
            <span>{summary.taxAmount ? formatter.format(summary.taxAmount) : "N/A"}</span>
          </div>
          <div>
            <strong>Discount</strong>
            <span>{summary.discountAmount ? formatter.format(summary.discountAmount) : "N/A"}</span>
          </div>
          <div className="invoice-sheet__summary-total">
            <strong>Total</strong>
            <span>{formatter.format(summary.total)}</span>
          </div>
        </div>
      </div>

      {profile?.signatureUrl ? (
        <div className="invoice-sheet__signature">
          <img src={profile.signatureUrl} alt="Signature" />
        </div>
      ) : null}
    </section>
  );
};
