async function main() {
  const { getSnowflakeConnection, connectSnowflake, fetchBillingItems, upsertBillingItems } = await import('@/lib/healthie/financials');

  const conn = getSnowflakeConnection();
  await connectSnowflake(conn);

  const billingItems = await fetchBillingItems();
  await upsertBillingItems(conn, billingItems);

  conn.destroy((err) => {
    if (err) {
      // eslint-disable-next-line no-console
      console.error('Error closing Snowflake connection', err);
    }
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Healthie ingest failed', err);
  process.exitCode = 1;
});
