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
		config = function()
			---@diagnostic disable-next-line: missing-fields
			require("nvim-treesitter.configs").setup({
				ensure_installed = {
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
				},
				highlight = { enable = true, disable = {} },
				indent = { enable = false, disable = {} },
			})
		end,
	},
}
