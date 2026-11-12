import { ASSET_KINDS, campaignPageSchema, contentDetailResponseSchema, type AssetLink } from "@crm/contracts/marketing";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "../../../../../components/ActionForm";
import { DataTable } from "../../../../../components/DataTable";
import { NotAllowed } from "../../../../../components/NotAllowed";
import { PageContent, PageToolbar } from "../../../../../components/PageToolbar";
import { Pill } from "../../../../../components/Pill";
import styles from "../../../../../components/RecordPage.module.css";
import { ASSET_KIND_LABELS, CHANNEL_LABELS, contentMoveTargets, CONTENT_STATUS_LABELS, formatCount } from "../../../../../lib/marketing-view";
import { canManageMarketing, canSeeMarketing } from "../../../../../lib/navigation";
import { isUuid } from "../../../../../lib/search-params";
import { collectPages, dataOrForbidden, serverGet } from "../../../../../lib/server-api";
import { requireAppSession } from "../../../../../lib/session";
import { isSafeProofUrl } from "../../../../../lib/task-actions";

export default async function ContentPage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await requireAppSession();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const detail = canSeeMarketing(user.role) ? dataOrForbidden(await serverGet(`/marketing/content/${id}`, contentDetailResponseSchema)) : "forbidden";
  if (detail === "forbidden") {
    return (
      <>
        <PageToolbar icon="calendar" title="Content" />
        <PageContent>
          <NotAllowed />
        </PageContent>
      </>
    );
  }
  const { content, assets } = detail;
  const manager = canManageMarketing(user.role);
  const editable = content.status !== "published" && content.status !== "cancelled";
  const campaigns = manager && editable ? await collectPages("/marketing/campaigns", campaignPageSchema) : null;
  const campaignOptions = campaigns?.ok
    ? campaigns.data.items.filter((c) => c.status !== "completed" && c.status !== "cancelled").map((c) => ({ value: c.id, label: c.name }))
    : [];
  const activeAssets = assets.filter((asset) => asset.removedAt === null);

  return (
    <>
      <PageToolbar icon="calendar" title={content.title} breadcrumbs={[{ href: "/marketing/content", label: "Content calendar" }]} />
      <PageContent>
        {manager ? (
          <div className={styles.actions}>
            {contentMoveTargets(content.status).map((to) => (
              <ActionForm
                key={to}
                label={to === "cancelled" ? "Cancel content" : `Move to ${CONTENT_STATUS_LABELS[to].toLowerCase()}`}
                title={to === "cancelled" ? "Cancel this content?" : `Move to ${CONTENT_STATUS_LABELS[to].toLowerCase()}?`}
                confirm="Confirm"
                variant={to === "cancelled" ? "danger" : "secondary"}
                path={`/marketing/content/${id}/status`}
                fixed={{ to }}
              />
            ))}
            {content.status === "in_review" ? (
              <ActionForm
                label="Mark published"
                title="Mark as published"
                confirm="Mark published"
                variant="primary"
                path={`/marketing/content/${id}/status`}
                fixed={{ to: "published" }}
                fields={[{ name: "proofUrl", label: "Link to the live post", kind: "url", required: true, hint: "An https:// link. It is stored, never fetched." }]}
              />
            ) : null}
            {content.status === "published" ? (
              <ActionForm
                label="Record outcome"
                title="Record outcome"
                confirm="Save outcome"
                path={`/marketing/content/${id}/outcome`}
                fields={[
                  { name: "reach", label: "Reach", kind: "number", defaultValue: content.reach === null ? "" : String(content.reach) },
                  { name: "engagements", label: "Engagements", kind: "number", defaultValue: content.engagements === null ? "" : String(content.engagements) },
                  { name: "clicks", label: "Clicks", kind: "number", defaultValue: content.clicks === null ? "" : String(content.clicks) },
                ]}
              />
            ) : null}
            {editable ? (
              <ActionForm
                label="Edit content"
                title="Edit content"
                confirm="Save"
                method="PATCH"
                path={`/marketing/content/${id}`}
                fields={[
                  { name: "title", label: "Title", kind: "text", required: true, maxLength: 200, defaultValue: content.title },
                  {
                    name: "campaignId",
                    label: "Campaign",
                    kind: "select",
                    empty: "null",
                    defaultValue: content.campaignId ?? "",
                    options: [{ value: "", label: "No campaign" }, ...campaignOptions],
                  },
                  { name: "plannedFor", label: "Planned for", kind: "date", empty: "null", defaultValue: content.plannedFor ?? "" },
                  { name: "brief", label: "Brief", kind: "textarea", empty: "null", maxLength: 2000, defaultValue: content.brief ?? "" },
                ]}
              />
            ) : null}
            {content.status !== "cancelled" ? (
              <ActionForm
                label="Add asset link"
                title="Add asset link"
                confirm="Add link"
                path={`/marketing/content/${id}/assets`}
                fields={[
                  { name: "label", label: "Label", kind: "text", required: true, maxLength: 200 },
                  { name: "url", label: "Link", kind: "url", required: true, hint: "An https:// link to the asset. No uploads." },
                  { name: "kind", label: "Kind", kind: "select", required: true, options: ASSET_KINDS.map((value) => ({ value, label: ASSET_KIND_LABELS[value] })) },
                ]}
              />
            ) : null}
          </div>
        ) : null}

        <dl className={styles.meta}>
          <dt>Status</dt>
          <dd>
            <Pill>{content.overdue ? `${CONTENT_STATUS_LABELS[content.status]} · overdue` : CONTENT_STATUS_LABELS[content.status]}</Pill>
          </dd>
          <dt>Channel</dt>
          <dd>{CHANNEL_LABELS[content.channel]}</dd>
          <dt>Campaign</dt>
          <dd>{content.campaignId ? <Link href={`/marketing/campaigns/${content.campaignId}`}>Open campaign</Link> : "—"}</dd>
          <dt>Planned for</dt>
          <dd>{content.plannedFor ?? "—"}</dd>
          <dt>Brief</dt>
          <dd className={styles.prose}>{content.brief ?? "—"}</dd>
          <dt>Proof</dt>
          <dd>
            {isSafeProofUrl(content.proofUrl) ? (
              <a href={content.proofUrl} target="_blank" rel="noopener noreferrer nofollow">
                Live post
              </a>
            ) : (
              "—"
            )}
          </dd>
          <dt>Outcome</dt>
          <dd>{`Reach ${formatCount(content.reach)} · Engagements ${formatCount(content.engagements)} · Clicks ${formatCount(content.clicks)}`}</dd>
        </dl>

        <section className={styles.section} aria-labelledby="assets-heading">
          <h2 id="assets-heading" className={styles.sectionTitle}>
            Asset links
          </h2>
          {activeAssets.length === 0 ? (
            <p className={styles.muted}>No asset links.</p>
          ) : (
            <DataTable<AssetLink>
              caption="Asset links"
              rowKey={(row) => row.id}
              rows={activeAssets}
              columns={[
                {
                  key: "label",
                  header: "Asset",
                  render: (row) =>
                    isSafeProofUrl(row.url) ? (
                      <a href={row.url} target="_blank" rel="noopener noreferrer nofollow">
                        {row.label}
                      </a>
                    ) : (
                      row.label
                    ),
                },
                { key: "kind", header: "Kind", render: (row) => ASSET_KIND_LABELS[row.kind] },
                {
                  key: "remove",
                  header: "",
                  render: (row) =>
                    manager ? (
                      <ActionForm label={`Remove ${row.label}`} title="Remove this link?" confirm="Remove" variant="danger" path={`/marketing/assets/${row.id}/remove`} />
                    ) : null,
                },
              ]}
            />
          )}
        </section>
      </PageContent>
    </>
  );
}
