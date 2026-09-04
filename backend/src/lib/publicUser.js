// Strips every credential-shaped column (`password_hash`, `session_token`)
// off a users row before it goes in any response. `hasPassword` is a safe
// derived boolean — it lets the frontend prompt a legacy (pre-password)
// account to set one, without ever exposing the hash itself.
const publicUser = (row) => ({
  id: row.id,
  username: row.username,
  display_name: row.display_name,
  avatar_url: row.avatar_url,
  hasPassword: Boolean(row.password_hash),
  created_at: row.created_at,
  updated_at: row.updated_at,
});

module.exports = { publicUser };
