#!/usr/bin/env node
import { createHash, randomBytes } from "node:crypto";
import { kv } from "@vercel/kv";
import { Command, Option } from "commander";

const program = new Command();

program
	.name("userkeys")
	.description("Manage user API keys stored in Vercel KV (hashed)")
	.version("1.0.0");

program
	.command("create")
	.description("Create a new user key (prints plaintext token once)")
	.requiredOption("--userId <id>", "User ID")
	.addOption(
		new Option("--status <status>")
			.choices(["active", "disabled"])
			.default("active"),
	)
	.option("--token <token>", "Provide a custom plaintext token")
	.action(async (opts) => {
		requireEnv();
		const userId = opts.userId;
		const status = opts.status === "disabled" ? "disabled" : "active";
		const token = opts.token || genToken(32);
		const tokenId = tokenToId(token);
		const key = `userkey:${tokenId}`;
		const record = {
			userId,
			status,
			createdAt: new Date().toISOString(),
		};
		const pipe = kv.pipeline();
		pipe.set(key, record, { nx: true });
		pipe.sadd(`userkeys:byUser:${userId}`, tokenId);
		const [setRes, saddRes] = await pipe.exec();
		if (setRes === null) fail("Token collision or key exists. Please retry.");
		if (typeof saddRes !== "number" || saddRes !== 1) {
			await kv.sadd(`userkeys:byUser:${userId}`, tokenId);
		}
		print({ token, tokenId, ...record });
	});

program
	.command("disable")
	.description("Disable a user key")
	.option("--token <token>", "Plaintext token")
	.option("--id <tokenId>", "Hashed token id (sha256 base64url)")
	.action(async (opts) => {
		requireEnv();
		const tokenId = resolveTokenIdArg(opts);
		const key = `userkey:${tokenId}`;
		const record = await kv.get(key);
		if (!record) fail("Not found");
		record.status = "disabled";
		record.updatedAt = new Date().toISOString();
		record.disabledAt = record.updatedAt;
		await kv.set(key, record);
		print({ tokenId, ...record });
	});

program
	.command("enable")
	.description("Enable a user key")
	.option("--token <token>", "Plaintext token")
	.option("--id <tokenId>", "Hashed token id (sha256 base64url)")
	.action(async (opts) => {
		requireEnv();
		const tokenId = resolveTokenIdArg(opts);
		const key = `userkey:${tokenId}`;
		const record = await kv.get(key);
		if (!record) fail("Not found");
		record.status = "active";
		record.updatedAt = new Date().toISOString();
		if (record.disabledAt) delete record.disabledAt;
		await kv.set(key, record);
		print({ tokenId, ...record });
	});

program
	.command("show")
	.description("Show a user key record by token or id")
	.option("--token <token>", "Plaintext token")
	.option("--id <tokenId>", "Hashed token id (sha256 base64url)")
	.action(async (opts) => {
		requireEnv();
		const tokenId = resolveTokenIdArg(opts);
		const key = `userkey:${tokenId}`;
		const record = await kv.get(key);
		if (!record) fail("Not found");
		print({ tokenId, ...record });
	});

program
	.command("list")
	.description("List all keys for a user")
	.requiredOption("--userId <id>", "User ID")
	.action(async (opts) => {
		requireEnv();
		const userId = opts.userId;
		const setKey = `userkeys:byUser:${userId}`;
		const tokenIds = (await kv.smembers(setKey)) || [];
		const items = (
			await Promise.all(
				tokenIds.map(async (id) => {
					const rec = await kv.get(`userkey:${id}`);
					return rec ? { tokenId: id, ...rec } : null;
				}),
			)
		).filter(Boolean);
		print({ userId, count: items.length, items });
	});

program
	.command("delete")
	.description("Delete a user key by token or id")
	.option("--token <token>", "Plaintext token")
	.option("--id <tokenId>", "Hashed token id (sha256 base64url)")
	.action(async (opts) => {
		requireEnv();
		const tokenId = resolveTokenIdArg(opts);
		const key = `userkey:${tokenId}`;
		const rec = await kv.get(key);
		if (!rec) fail("Not found");
		const pipe = kv.pipeline();
		pipe.del(key);
		pipe.srem(`userkeys:byUser:${rec.userId}`, tokenId);
		await pipe.exec();
		print({ deleted: true, tokenId, userId: rec.userId });
	});

program
	.command("rotate")
	.description(
		"Rotate a user key: issue new token for the same user and disable old one",
	)
	.option("--token <token>", "Plaintext token of the old key")
	.option("--id <tokenId>", "Hashed token id (sha256 base64url) of the old key")
	.action(async (opts) => {
		requireEnv();
		const oldId = resolveTokenIdArg(opts);
		const oldKey = `userkey:${oldId}`;
		const oldRec = await kv.get(oldKey);
		if (!oldRec) fail("Not found");

		const newToken = genToken(32);
		const newId = tokenToId(newToken);
		const newKey = `userkey:${newId}`;
		const now = new Date().toISOString();
		const newRec = {
			userId: oldRec.userId,
			status: "active",
			createdAt: now,
		};

		const pipe = kv.pipeline();
		pipe.set(newKey, newRec, { nx: true });
		pipe.sadd(`userkeys:byUser:${oldRec.userId}`, newId);
		oldRec.status = "disabled";
		oldRec.updatedAt = now;
		oldRec.disabledAt = now;
		pipe.set(oldKey, oldRec);
		const [setRes] = await pipe.exec();
		if (setRes === null) fail("Token collision on rotate. Retry.");
		print({
			rotated: true,
			oldTokenId: oldId,
			newToken,
			newTokenId: newId,
			userId: oldRec.userId,
		});
	});

program
	.command("update")
	.description("Update fields of a user key (status)")
	.option("--token <token>", "Plaintext token")
	.option("--id <tokenId>", "Hashed token id (sha256 base64url)")
	.addOption(new Option("--status <status>").choices(["active", "disabled"]))
	.action(async (opts) => {
		requireEnv();
		const tokenId = resolveTokenIdArg(opts);
		const key = `userkey:${tokenId}`;
		const rec = await kv.get(key);
		if (!rec) fail("Not found");
		if (opts.status) {
			rec.status = opts.status;
			if (opts.status === "disabled") rec.disabledAt = new Date().toISOString();
			else if (rec.disabledAt) delete rec.disabledAt;
		}
		rec.updatedAt = new Date().toISOString();
		await kv.set(key, rec);
		print({ tokenId, ...rec });
	});

program
	.parseAsync(process.argv)
	.catch((err) => fail(err?.message ?? String(err)));

function requireEnv() {
	const url = process.env.KV_REST_API_URL;
	const token = process.env.KV_REST_API_TOKEN;
	if (!url || !token) {
		fail(
			"Missing KV_REST_API_URL or KV_REST_API_TOKEN in environment. Tip: vercel dev injects them if KV is linked.",
		);
	}
}

function genToken(len = 32) {
	return randomBytes(len).toString("base64url");
}

function tokenToId(token) {
	return createHash("sha256").update(token).digest("base64url");
}

function resolveTokenIdArg(opts) {
	const t = opts.token || null;
	const id = opts.id || null;
	if (!t && !id) fail("Provide --token <token> or --id <tokenId>");
	if (id) return id;
	return tokenToId(t);
}

function print(obj) {
	console.log(JSON.stringify(obj, null, 2));
}

function fail(msg) {
	console.error(msg);
	process.exit(1);
}
