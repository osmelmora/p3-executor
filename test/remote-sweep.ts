// A generated sweep over project remotes. Each remote's expected identity comes from how it was built (endpoint and
// repository), never from the normalizer, so the sweep checks the documented contract rather than restating the code:
// every remote is accepted, its key normalizes to itself, and two remotes share a key exactly when they share an identity.

/** Documented contract: each transport's default port, and the one host whose paths ignore case. */
const defaultPorts = new Map([
  ["https", 443],
  ["http", 80],
  ["ssh", 22],
  ["git+ssh", 22],
  ["ssh+git", 22],
  ["git", 9418],
]);
const caseInsensitiveHosts = new Set(["github.com"]);

export interface SweepDimensions {
  /** URL transports, in any case. */
  readonly schemes: readonly string[];
  /** Hosts in any case; IPv6 in brackets. */
  readonly hosts: readonly string[];
  /** Ports as written; undefined omits the port. Leading zeros are allowed. */
  readonly ports: readonly (string | undefined)[];
  /** Repository paths, in the case the server stores them. */
  readonly repositories: readonly string[];
  /** Endings such as `.GIT`: part of the path where case matters, a `.git` ending on a case-insensitive host. */
  readonly caseSuffixes: readonly string[];
  /** Endings every host drops: `/`, `.git`, and runs of them. */
  readonly trims: readonly string[];
  /** Extra slashes before the path. */
  readonly leadings: readonly string[];
  /** Userinfo before the host and a query or fragment after the path. Neither may reach a key. */
  readonly decorations: readonly { readonly user: string; readonly tail: string }[];
}

export const secrets = ["TOKEN", "QSECRET", "FRAGSECRET"] as const;

export interface Failure {
  readonly kind: "rejected" | "unstable" | "secret" | "split" | "merged";
  readonly raw: string;
  readonly detail: string;
}

export interface SweepResult {
  readonly remotes: number;
  readonly identities: number;
  readonly keys: number;
  readonly failureCounts: Record<Failure["kind"], number>;
  /** The first few failures of each kind. */
  readonly failures: Failure[];
}

const identityOf = (host: string, port: string, repository: string, caseSuffix: string): string => {
  const endpoint = host.toLowerCase();
  const path = caseInsensitiveHosts.has(endpoint) ? repository.toLowerCase() : `${repository}${caseSuffix}`;
  return `${endpoint} ${port} ${path}`;
};

function* remotes(d: SweepDimensions): Generator<[raw: string, identity: string]> {
  for (const host of d.hosts)
    for (const repository of d.repositories)
      for (const caseSuffix of d.caseSuffixes)
        for (const trim of d.trims)
          for (const leading of d.leadings) {
            const path = `${leading}${repository}${caseSuffix}${trim}`;
            for (const { user, tail } of d.decorations) {
              for (const scheme of d.schemes) {
                const fallback = defaultPorts.get(scheme.toLowerCase())!;
                for (const port of d.ports) {
                  const effective = port === undefined ? fallback : Number(port);
                  const label = effective === fallback ? "default" : String(effective);
                  yield [
                    `${scheme}://${user}${host}${port === undefined ? "" : `:${port}`}/${path}${tail}`,
                    identityOf(host, label, repository, caseSuffix),
                  ];
                }
              }
              // A key form names no scheme, so a written port is kept as written.
              for (const port of d.ports) {
                yield [
                  `//${user}${host}${port === undefined ? "" : `:${port}`}/${path}${tail}`,
                  identityOf(host, port === undefined ? "default" : String(Number(port)), repository, caseSuffix),
                ];
              }
            }
            // git's scp form has no port, query, or password.
            for (const user of ["", "git@"]) yield [`${user}${host}:${path}`, identityOf(host, "default", repository, caseSuffix)];
          }
}

export const sweep = (normalize: (raw: string) => string, dimensions: SweepDimensions, keep = 5): SweepResult => {
  const failureCounts: Record<Failure["kind"], number> = { rejected: 0, unstable: 0, secret: 0, split: 0, merged: 0 };
  const failures: Failure[] = [];
  const fail = (failure: Failure) => {
    if (failureCounts[failure.kind]++ < keep) failures.push(failure);
  };
  const keyByIdentity = new Map<string, string>();
  const identityByKey = new Map<string, string>();
  let count = 0;
  for (const [raw, identity] of remotes(dimensions)) {
    count += 1;
    let key: string;
    try {
      key = normalize(raw);
    } catch (error) {
      fail({ kind: "rejected", raw, detail: String((error as Error).message) });
      continue;
    }
    let again: string;
    try {
      again = normalize(normalize(key));
    } catch (error) {
      again = `throws: ${String((error as Error).message)}`;
    }
    if (again !== key) fail({ kind: "unstable", raw, detail: `${key} -> ${again}` });
    const leaked = secrets.find((secret) => key.includes(secret));
    if (leaked !== undefined) fail({ kind: "secret", raw, detail: `${leaked} in ${key}` });
    const seenKey = keyByIdentity.get(identity);
    if (seenKey === undefined) keyByIdentity.set(identity, key);
    else if (seenKey !== key) fail({ kind: "split", raw, detail: `${identity}: ${seenKey} and ${key}` });
    const seenIdentity = identityByKey.get(key);
    if (seenIdentity === undefined) identityByKey.set(key, identity);
    else if (seenIdentity !== identity) fail({ kind: "merged", raw, detail: `${key}: ${seenIdentity} and ${identity}` });
  }
  return { remotes: count, identities: keyByIdentity.size, keys: identityByKey.size, failureCounts, failures };
};

/** Ports that name no endpoint, or that print back as something other than the digits written. */
export const invalidPorts = ["0", "00", "65536", "99999", "123456789012345678", "9".repeat(25), "9".repeat(400)];
