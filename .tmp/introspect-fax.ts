import https from 'https';

const API_KEY = process.env.HEALTHIE_API_KEY;
if (!API_KEY) {
  console.error('HEALTHIE_API_KEY not set');
  process.exit(1);
}

async function query(gql: string, variables?: Record<string, any>): Promise<any> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query: gql, variables });
    const req = https.request('https://api.gethealthie.com/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${API_KEY}`,
        'AuthorizationSource': 'API',
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(new Error(data)); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  // 1. Find all types with "Fax" in the name
  console.log('=== INTROSPECTING FAX-RELATED TYPES ===\n');
  
  const typesResult = await query(`{
    __schema {
      types {
        name
        kind
        description
        fields { name type { name kind ofType { name kind ofType { name kind } } } description }
        inputFields { name type { name kind ofType { name kind ofType { name kind } } } description defaultValue }
        enumValues { name description }
      }
    }
  }`);

  if (typesResult.errors) {
    console.error('Errors:', JSON.stringify(typesResult.errors, null, 2));
    return;
  }

  const allTypes = typesResult.data.__schema.types;
  const faxTypes = allTypes.filter((t: any) => t.name?.toLowerCase().includes('fax'));
  
  console.log('--- Fax-related Types ---');
  for (const t of faxTypes) {
    console.log(`\nType: ${t.name} (${t.kind})`);
    if (t.description) console.log(`  Description: ${t.description}`);
    if (t.fields?.length) {
      console.log('  Fields:');
      for (const f of t.fields) {
        const typeName = f.type?.name || f.type?.ofType?.name || f.type?.ofType?.ofType?.name || JSON.stringify(f.type);
        console.log(`    - ${f.name}: ${typeName}${f.description ? ' // ' + f.description : ''}`);
      }
    }
    if (t.inputFields?.length) {
      console.log('  Input Fields:');
      for (const f of t.inputFields) {
        const typeName = f.type?.name || f.type?.ofType?.name || f.type?.ofType?.ofType?.name || JSON.stringify(f.type);
        console.log(`    - ${f.name}: ${typeName}${f.defaultValue ? ' (default: ' + f.defaultValue + ')' : ''}${f.description ? ' // ' + f.description : ''}`);
      }
    }
    if (t.enumValues?.length) {
      console.log('  Enum Values:');
      for (const v of t.enumValues) {
        console.log(`    - ${v.name}${v.description ? ' // ' + v.description : ''}`);
      }
    }
  }

  // 2. Find fax-related queries
  console.log('\n\n=== FAX-RELATED QUERIES ===\n');
  const queryType = allTypes.find((t: any) => t.name === 'Query');
  const faxQueries = queryType?.fields?.filter((f: any) => f.name?.toLowerCase().includes('fax')) || [];
  for (const q of faxQueries) {
    const typeName = q.type?.name || q.type?.ofType?.name || q.type?.ofType?.ofType?.name || JSON.stringify(q.type);
    console.log(`Query: ${q.name} -> ${typeName}`);
    if (q.description) console.log(`  Description: ${q.description}`);
  }
  if (!faxQueries.length) console.log('(none found)');

  // 3. Find fax-related mutations
  console.log('\n\n=== FAX-RELATED MUTATIONS ===\n');
  const mutationType = allTypes.find((t: any) => t.name === 'Mutation');
  const faxMutations = mutationType?.fields?.filter((f: any) => f.name?.toLowerCase().includes('fax')) || [];
  for (const m of faxMutations) {
    const typeName = m.type?.name || m.type?.ofType?.name || m.type?.ofType?.ofType?.name || JSON.stringify(m.type);
    console.log(`Mutation: ${m.name} -> ${typeName}`);
    if (m.description) console.log(`  Description: ${m.description}`);
  }
  if (!faxMutations.length) console.log('(none found)');

  // 4. Find document-related mutations (might support fax)
  console.log('\n\n=== DOCUMENT-RELATED MUTATIONS (may support fax) ===\n');
  const docMutations = mutationType?.fields?.filter((f: any) => 
    f.name?.toLowerCase().includes('document') || 
    f.name?.toLowerCase().includes('upload') ||
    f.name?.toLowerCase().includes('attachment')
  ) || [];
  for (const m of docMutations) {
    const typeName = m.type?.name || m.type?.ofType?.name || m.type?.ofType?.ofType?.name || JSON.stringify(m.type);
    console.log(`Mutation: ${m.name} -> ${typeName}`);
    if (m.description) console.log(`  Description: ${m.description}`);
  }

  // 5. Now get detailed input types for fax mutations
  if (faxMutations.length > 0) {
    console.log('\n\n=== DETAILED FAX MUTATION INPUT TYPES ===\n');
    // Get args for each fax mutation
    const detailResult = await query(`{
      __schema {
        mutationType {
          fields {
            name
            args {
              name
              type { name kind ofType { name kind ofType { name kind ofType { name kind } } } }
              description
              defaultValue
            }
          }
        }
      }
    }`);

    const mutations = detailResult.data.__schema.mutationType.fields;
    const faxMuts = mutations.filter((m: any) => m.name.toLowerCase().includes('fax'));
    
    for (const m of faxMuts) {
      console.log(`\nMutation: ${m.name}`);
      console.log('  Arguments:');
      for (const a of m.args) {
        const typeName = a.type?.name || a.type?.ofType?.name || a.type?.ofType?.ofType?.name || a.type?.ofType?.ofType?.ofType?.name || JSON.stringify(a.type);
        console.log(`    - ${a.name}: ${typeName}${a.description ? ' // ' + a.description : ''}`);
      }
    }
  }

  // 6. Also check for "send" mutations that might relate to fax
  console.log('\n\n=== SEND-RELATED MUTATIONS ===\n');
  const sendMutations = mutationType?.fields?.filter((f: any) => f.name?.toLowerCase().includes('send')) || [];
  for (const m of sendMutations) {
    const typeName = m.type?.name || m.type?.ofType?.name || m.type?.ofType?.ofType?.name || JSON.stringify(m.type);
    console.log(`Mutation: ${m.name} -> ${typeName}`);
  }
}

main().catch(console.error);
