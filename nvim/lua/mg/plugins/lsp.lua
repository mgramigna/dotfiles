return {
	{
		"williamboman/mason.nvim",
		cmd = "Mason",
		config = function()
			require("mason").setup()
		end,
	},
	{
		"folke/trouble.nvim",
		cmd = "Trouble",
		dependencies = { "nvim-tree/nvim-web-devicons" },
		opts = {},
	},
	{
		"neovim/nvim-lspconfig",
		event = "BufRead",
		dependencies = {
			{
				"mrcjkb/rustaceanvim",
				version = "^4",
				ft = { "rust" },
			},
			{
				"marilari88/twoslash-queries.nvim",
				config = function()
					require("twoslash-queries").setup({
						multi_line = true,
					})

					vim.keymap.set("n", "<leader>ti", "<cmd>TwoslashQueriesInspect<cr>", { noremap = true })
				end,
			},
			-- {
			-- 	"pmizio/typescript-tools.nvim",
			-- 	dependencies = { "nvim-lua/plenary.nvim" },
			-- 	config = function()
			-- 		local api = require("typescript-tools.api")
			-- 		require("typescript-tools").setup({
			-- 			on_attach = function(client, bufnr)
			-- 				require("twoslash-queries").attach(client, bufnr)
			-- 			end,
			-- 			handlers = {
			-- 				-- Ignore "X is defined but never read" (handled by eslint)
			-- 				["textDocument/publishDiagnostics"] = api.filter_diagnostics({ 6133 }),
			-- 				["textDocument/hover"] = vim.lsp.with(vim.lsp.handlers.hover, { border = "rounded" }),
			-- 			},
			-- 			settings = {
			-- 				separate_diagnostic_server = true,
			-- 				publish_diagnostic_on = "insert_leave",
			-- 				tsserver_max_memory = "auto",
			-- 				expose_as_code_action = "all",
			-- 			},
			-- 		})

			-- 		vim.keymap.set("n", "<leader>ai", "<cmd>TSToolsAddMissingImports<cr>", { noremap = true })
			-- 		vim.keymap.set("n", "<leader>ri", "<cmd>TSToolsRemoveUnusedImports<cr>", { noremap = true })
			-- 		vim.keymap.set("n", "<leader>sd", "<cmd>TSToolsGoToSourceDefinition<cr>", { noremap = true })
			-- 		vim.keymap.set("n", "<leader>ef", "<cmd>EslintFixAll<cr>", { noremap = true })
			-- 	end,
			-- },
			{
				"j-hui/fidget.nvim",
				opts = {},
			},
			{
				"williamboman/mason-lspconfig.nvim",
				config = function()
					require("mason-lspconfig").setup({
						ensure_installed = {
							"astro",
							"eslint",
							"jdtls",
							"lua_ls",
							"prismals",
							"python-lsp-server",
							"rust_analyzer",
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

			local default_handlers = {
				["textDocument/hover"] = vim.lsp.with(vim.lsp.handlers.hover, { border = "rounded" }),
			}

			vim.api.nvim_create_autocmd("LspAttach", {
				group = vim.api.nvim_create_augroup("MgLspConfig", {}),
				callback = function(ev)
					local opts = { noremap = true, silent = true, buffer = ev.buf }

					vim.keymap.set("n", "gD", vim.lsp.buf.declaration, opts)
					vim.keymap.set("n", "gd", vim.lsp.buf.definition, opts)
					vim.keymap.set("n", "gi", vim.lsp.buf.implementation, opts)
					vim.keymap.set("n", "gt", vim.lsp.buf.type_definition, opts)
					vim.keymap.set("n", "<leader>rn", vim.lsp.buf.rename, opts)

					vim.keymap.set("n", "gr", function()
						require("telescope.builtin").lsp_references()
					end, opts)

					vim.keymap.set("n", "<leader>e", vim.diagnostic.open_float)
					vim.keymap.set("n", "[g", vim.diagnostic.goto_prev)
					vim.keymap.set("n", "]g", vim.diagnostic.goto_next)
					vim.keymap.set("n", "K", vim.lsp.buf.hover, opts)
					vim.keymap.set("n", "<leader>do", vim.lsp.buf.code_action, opts)

					local eslint_group = vim.api.nvim_create_augroup("EslintFix", { clear = true })
					vim.keymap.set("n", "<leader>ef", "<cmd>EslintFixAll<cr>", { noremap = true })

					vim.api.nvim_create_autocmd("BufWritePre", {
						group = eslint_group,
						callback = function()
							if vim.fn.exists(":EslintFixAll") > 0 then
								vim.cmd("EslintFixAll")
							end
						end,
					})
				end,
			})

			local capabilities = require("cmp_nvim_lsp").default_capabilities()

			vim.diagnostic.config({
				float = {
					border = "rounded",
				},
			})

			require("mason-lspconfig").setup_handlers({
				function(server_name)
					lspconfig[server_name].setup({
						capabilities = capabilities,
						handlers = default_handlers,
					})
				end,

				["tsserver"] = function()
					lspconfig["tsserver"].setup({
						capabilities = capabilities,
						handlers = default_handlers,
						on_attach = function(client, bufnr)
							require("twoslash-queries").attach(client, bufnr)
						end,
					})
				end,

				["rust_analyzer"] = function()
					vim.g.rustaceanvim = {
						tools = {},
						server = {
							default_settings = {
								["rust-analyzer"] = {},
							},
						},
					}
				end,

				["lua_ls"] = function()
					lspconfig["lua_ls"].setup({
						capabilities = capabilities,
						handlers = default_handlers,
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
		end,
	},
}
