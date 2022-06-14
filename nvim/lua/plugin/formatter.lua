return function()
	require("formatter").setup({
		filetype = {
			lua = {
				require("formatter.filetypes.lua").stylua,
			},
			javascript = {
				require("formatter.filetypes.javascript").prettier,
			},
			javascriptreact = {
				require("formatter.filetypes.javascriptreact").prettier,
			},
			typescript = {
				require("formatter.filetypes.typescript").prettier,
			},
			typescriptreact = {
				require("formatter.filetypes.typescriptreact").prettier,
			},
			ruby = {
				require("formatter.filetypes.ruby").rubocop,
			},
			rust = {
				require("formatter.filetypes.rust").rustfmt,
			},
		},
	})

	local format_group = vim.api.nvim_create_augroup("Format", { clear = true })

	vim.api.nvim_create_autocmd("BufWritePost", {
		command = "FormatWrite",
		group = format_group,
	})
end
