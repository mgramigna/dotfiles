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
			require("lspsaga").setup({
				diagnostic = {
					jump_num_shortcut = false,
					show_code_action = false,
				},
			})

			vim.keymap.set({ "n", "t" }, "<leader>lt", "<cmd>Lspsaga term_toggle<CR>")
		end,
	},
	{
		"neovim/nvim-lspconfig",
		event = "BufReadPre",
		dependencies = {
			{
				"simrat39/rust-tools.nvim",
			},
			{
				"j-hui/fidget.nvim",
				tag = "legacy",
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
			vim.api.nvim_create_autocmd("LspAttach", {
				group = vim.api.nvim_create_augroup("MgLspConfig", {}),
				callback = function(ev)
					local opts = { noremap = true, silent = true, buffer = ev.buf }

					vim.keymap.set("n", "gD", "<cmd>lua vim.lsp.buf.declaration()<CR>", opts)
					vim.keymap.set("n", "gd", "<cmd>lua vim.lsp.buf.definition()<CR>", opts)
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
				end,
			})

			local capabilities = require("cmp_nvim_lsp").default_capabilities()

			require("mason-lspconfig").setup_handlers({
				function(server_name)
					lspconfig[server_name].setup({
						capabilities = capabilities,
					})
				end,

				["rust_analyzer"] = function()
					require("rust-tools").setup({
						tools = {
							inlay_hints = {
								auto = true,
							},
						},
					})
				end,

				["lua_ls"] = function()
					lspconfig["lua_ls"].setup({
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
						cmd = { "cql-language-server" },
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
