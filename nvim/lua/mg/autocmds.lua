local local_opt_group = vim.api.nvim_create_augroup("LocalOpts", { clear = true })

vim.api.nvim_create_autocmd(
	{ "BufRead", "BufNewFile" },
	{ group = local_opt_group, pattern = { "*.md" }, command = "setlocal spell" }
)

vim.api.nvim_create_autocmd("TermOpen", {
	group = local_opt_group,
	callback = function()
		vim.opt_local.number = false
		vim.opt_local.relativenumber = false
		vim.opt_local.spell = false
	end,
})

local hl_yank_group = vim.api.nvim_create_augroup("HighlightYank", { clear = true })

vim.api.nvim_create_autocmd("TextYankPost", {
	group = hl_yank_group,
	callback = function()
		vim.highlight.on_yank()
	end,
})

local cmd_height_group = vim.api.nvim_create_augroup("CmdHeight", { clear = true })

vim.api.nvim_create_autocmd("RecordingEnter", {
	group = cmd_height_group,
	command = "setlocal cmdheight=1",
})

vim.api.nvim_create_autocmd("RecordingLeave", {
	group = cmd_height_group,
	command = "setlocal cmdheight=0",
})
