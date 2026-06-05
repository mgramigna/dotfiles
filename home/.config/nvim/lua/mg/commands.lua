-- Copy absolute path to clipboard
vim.api.nvim_create_user_command("CpAbs", function()
	local path = vim.fn.expand("%:p")
	vim.fn.setreg("+", path)
	vim.notify('Copied "' .. path .. '" to clipboard')
end, {})

-- Copy relative path to clipboard
vim.api.nvim_create_user_command("CpRel", function()
	local path = vim.fn.expand("%:.")

	vim.fn.setreg("+", path)
	vim.notify('Copied "' .. path .. '" to clipboard')
end, {})
