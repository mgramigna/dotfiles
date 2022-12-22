local util = require("formatter.util")
require("formatter").setup({
	filetype = {
		c = {
			require("formatter.filetypes.c").clangformat,
		},
		lua = {
			require("formatter.filetypes.lua").stylua,
		},
		javascript = {
			require("formatter.filetypes.javascript").prettier,
		},
		javascriptreact = {
			require("formatter.filetypes.javascriptreact").prettier,
		},
		json = {
			require("formatter.filetypes.json").prettier,
		},
		markdown = {
			require("formatter.filetypes.markdown").prettier,
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
		astro = {
			function()
				return {
					exe = "prettier",
					args = {
						"--stdin-filepath",
						util.escape_path(util.get_current_buffer_file_path()),
						"--parser",
						"astro",
						"--plugin-search-dir=.",
					},
					stdin = true,
					try_node_modules = true,
				}
			end,
		},
	},
})

local format_group = vim.api.nvim_create_augroup("Format", { clear = true })

vim.api.nvim_create_autocmd("BufWritePost", {
	command = "FormatWrite",
	group = format_group,
})

vim.api.nvim_set_keymap("n", "<leader>f", "<cmd>Format<cr>", { noremap = true })
vim.api.nvim_set_keymap("n", "<leader>F", "<cmd>FormatWrite<cr>", { noremap = true })
