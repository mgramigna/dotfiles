return {
	{
		"windwp/nvim-ts-autotag",
		config = function()
			---@diagnostic disable-next-line: missing-fields
			require("nvim-ts-autotag").setup({
				opts = {
					-- Defaults
					enable_close = true, -- Auto close tags
					enable_rename = true, -- Auto rename pairs of tags
					enable_close_on_slash = false, -- Auto close on trailing </
				},
			})
		end,
	},
	{
		"nvim-treesitter/nvim-treesitter",
		lazy = false,
		build = ":TSUpdate",
		branch = "main",
		init = function()
			vim.api.nvim_create_autocmd("FileType", {
				callback = function()
					pcall(vim.treesitter.start)
					vim.bo.indentexpr = "v:lua.require'nvim-treesitter'.indentexpr()"
				end,
			})

			local ensure_installed = {
				"javascript",
				"json",
				"lua",
				"tsx",
				"typescript",
				"java",
				"query",
				"prisma",
				"rust",
				"comment",
				"markdown",
				"markdown_inline",
				"graphql",
			}

			local alreadyInstalled = require("nvim-treesitter.config").get_installed()
			local parsersToInstall = vim.iter(ensure_installed)
				:filter(function(parser)
					return not vim.tbl_contains(alreadyInstalled, parser)
				end)
				:totable()
			require("nvim-treesitter").install(parsersToInstall)
		end,
	},
}
