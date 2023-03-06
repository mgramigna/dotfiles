return {
	{
		"williamboman/mason.nvim",
		cmd = "Mason",
		config = function()
			require("mason").setup()
		end,
	},
	{
		"glepnir/lspsaga.nvim",
		event = "BufRead",
		config = function()
			require("lspsaga").setup({})

			vim.keymap.set({ "n", "t" }, "<leader>lt", "<cmd>Lspsaga term_toggle<CR>")
		end,
	},
	{
		"neovim/nvim-lspconfig",
		event = "BufReadPre",
		dependencies = {
			{
				"j-hui/fidget.nvim",
				config = function()
					require("fidget").setup()
				end,
			},
			{
				"williamboman/mason-lspconfig.nvim",
				config = function()
					require("mason-lspconfig").setup({
						ensure_installed = {
							"astro",
							"eslint",
							"jdtls",
							"prismals",
							"pyright",
							"rust_analyzer",
							"solargraph",
							"lua_ls",
							"tailwindcss",
							"texlab",
							"tsserver",
						},
					})
				end,
			},
			{
				"folke/neodev.nvim",
				config = function()
					require("neodev").setup({})
				end,
			},
		},
		config = function()
			local lspconfig = require("lspconfig")
			local on_attach = function(client, bufnr)
				local opts = { noremap = true, silent = true, buffer = bufnr }

				client.server_capabilities.documentFormatting = false
				client.server_capabilities.documentFormatting = false

				vim.keymap.set("n", "gD", "<Cmd>lua vim.lsp.buf.declaration()<CR>", opts)
				vim.keymap.set("n", "gd", "<Cmd>lua vim.lsp.buf.definition()<CR>", opts)
				vim.keymap.set("n", "gi", "<cmd>lua vim.lsp.buf.implementation()<CR>", opts)
				vim.keymap.set("n", "gt", "<cmd>lua vim.lsp.buf.type_definition()<CR>", opts)
				vim.keymap.set("n", "<leader>rn", "<cmd>Lspsaga rename<CR>", opts)
				vim.keymap.set("n", "gr", "<cmd>Lspsaga lsp_finder<CR>", opts)
				vim.keymap.set("n", "<leader>ec", "<cmd>Lspsaga show_cursor_diagnostics<CR>", opts)
				vim.keymap.set("n", "<leader>e", "<cmd>Lspsaga show_line_diagnostics<CR>", opts)
				vim.keymap.set("n", "]g", "<cmd>Lspsaga diagnostic_jump_next<CR>", opts)
				vim.keymap.set("n", "[g", "<cmd>Lspsaga diagnostic_jump_prev<CR>", opts)
				vim.keymap.set("n", "K", "<cmd>Lspsaga hover_doc<CR>", opts)
				vim.keymap.set("n", "<leader>do", "<cmd>Lspsaga code_action<CR>", opts)
				vim.keymap.set("n", "<leader>o", "<cmd>Lspsaga outline<CR>", opts)
			end

			local capabilities = require("cmp_nvim_lsp").default_capabilities()

			require("mason-lspconfig").setup_handlers({
				function(server_name)
					lspconfig[server_name].setup({
						on_attach = on_attach,
						capabilities = capabilities,
					})
				end,

				["lua_ls"] = function()
					lspconfig["lua_ls"].setup({
						on_attach = on_attach,
						capabilities = capabilities,
						settings = {
							Lua = {
								completion = {
									callSnippet = "Replace",
								},
							},
						},
					})
				end,
			})

			local configs = require("lspconfig.configs")
			if not configs.cql_ls then
				configs.cql_ls = {
					default_config = {
						cmd = {
							"java",
							"-jar",
							"/Users/mgramigna/Projects/sandboxes/cql-language-server/cql-ls/target/cql-ls-1.5.6-shaded.jar",
						},
						filetypes = { "cqlang" },
						root_dir = function(fname)
							return lspconfig.util.find_git_ancestor(fname)
						end,
						settings = {},
					},
				}
			end

			lspconfig.cql_ls.setup({
				on_attach = on_attach,
				capabilities = capabilities,
			})
		end,
	},
}
