return {
	{
		"nvim-treesitter/playground",
		cmd = "TSPlaygroundToggle",
	},
	{
		"nvim-treesitter/nvim-treesitter-context",
		event = "BufReadPre",
	},
	{
		"windwp/nvim-ts-autotag",
		event = "BufReadPre",
	},
	{
		"p00f/nvim-ts-rainbow",
		event = "BufReadPre",
	},
	{
		"JoosepAlviste/nvim-ts-context-commentstring",
		event = "BufReadPre",
	},
	{
		"nvim-treesitter/nvim-treesitter",
		config = function()
			local parser_config = require("nvim-treesitter.parsers").get_parser_configs()

			parser_config.fsh = {
				install_info = {
					url = "https://github.com/mgramigna/tree-sitter-fsh",
					files = { "src/parser.c" },
					branch = "main",
				},
				filetype = "fsh",
			}

			parser_config.cql = {
				install_info = {
					url = "https://github.com/mgramigna/tree-sitter-cql",
					files = { "src/parser.c" },
					branch = "main",
				},
				filetype = "cqlang",
			}

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
				},
				highlight = { enable = true, disable = {} },
				indent = { enable = false, disable = {} },
				rainbow = {
					enable = true,
					disable = { "jsx", "tsx", "html" },
				},
				playground = {
					enable = true,
					disable = {},
					updatetime = 25, -- Debounced time for highlighting nodes in the playground from source code
					persist_queries = false, -- Whether the query persists across vim sessions
					keybindings = {
						toggle_query_editor = "o",
						toggle_hl_groups = "i",
						toggle_injected_languages = "t",
						toggle_anonymous_nodes = "a",
						toggle_language_display = "I",
						focus_language = "f",
						unfocus_language = "F",
						update = "R",
						goto_node = "<cr>",
						show_help = "?",
					},
				},
				context_commentstring = {
					enable = true,
				},
				autotag = {
					enable = true,
				},
			})
		end,
	},
}
