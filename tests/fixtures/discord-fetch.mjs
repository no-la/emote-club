// Loaded only by the isolated HTTP test child process, never imported by the application.
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.origin === "https://discord.com") {
    const token = new Headers(init?.headers).get("authorization");
    if (url.pathname === "/api/v10/users/@me/guilds" && token === "Bearer unused-test-token") {
      return Response.json([{id:"223456789012345678",name:"test guild",permissions:"0"}]);
    }
    return Response.json({message:"invalid token"},{status:401});
  }
  return realFetch(input,init);
};
